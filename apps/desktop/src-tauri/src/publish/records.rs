//! SQLite records for connected accounts and publishing jobs.

use rusqlite::{OptionalExtension, Row, params};

use super::{Account, DraftInput, Platform, PublishJob, PublishTask, check_draft};
use crate::{
    model::{Result, StudioError},
    store::Store,
};

const ACCOUNT: &str =
    "SELECT id, platform, variant, remote_id, name, secret_ref, expires_at FROM connected_accounts";
const JOB: &str = "SELECT j.id, j.account_id, a.platform, a.name, j.format, j.caption, j.title, j.privacy, j.media,
       CASE j.media WHEN 'url' THEN j.media_url WHEN 'asset' THEN s.relative_path
                    WHEN 'render' THEN r.output_path END,
       j.status, j.remote_id, j.permalink, j.error, j.created_at, j.published_at
     FROM publishing_jobs j JOIN connected_accounts a ON a.id = j.account_id
     LEFT JOIN assets s ON s.id = j.asset_id LEFT JOIN render_jobs r ON r.id = j.render_job_id";
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
const NO_ACCOUNT: StudioError = StudioError::Input("Không tìm thấy tài khoản đã kết nối.");
const NO_JOB: StudioError = StudioError::Input("Không tìm thấy bài đăng.");

fn account(row: &Row) -> rusqlite::Result<(Account, String)> {
    let platform: String = row.get(1)?;
    Ok((
        Account {
            id: row.get(0)?,
            // Replaced right after the query, where an unknown value can be reported.
            platform: Platform::Threads,
            variant: row.get(2)?,
            remote_id: row.get(3)?,
            name: row.get(4)?,
            secret_ref: row.get(5)?,
            expires_at: row.get(6)?,
        },
        platform,
    ))
}

fn typed((mut account, platform): (Account, String)) -> Result<Account> {
    account.platform = Platform::parse(&platform)?;
    Ok(account)
}

fn job(row: &Row) -> rusqlite::Result<PublishJob> {
    Ok(PublishJob {
        id: row.get(0)?,
        account_id: row.get(1)?,
        platform: row.get(2)?,
        account_name: row.get(3)?,
        format: row.get(4)?,
        caption: row.get(5)?,
        title: row.get(6)?,
        privacy: row.get(7)?,
        media: row.get(8)?,
        media_label: row.get(9)?,
        status: row.get(10)?,
        remote_id: row.get(11)?,
        permalink: row.get(12)?,
        error: row.get(13)?,
        created_at: row.get(14)?,
        published_at: row.get(15)?,
    })
}

impl Store {
    /// Adds an account or refreshes the name of one that is connected again.
    pub fn save_social_account(
        &self,
        platform: &str,
        variant: &str,
        remote_id: &str,
        name: &str,
        secret_ref: &str,
    ) -> Result<i64> {
        Ok(self.db()?.query_row(
            "INSERT INTO connected_accounts(platform, variant, remote_id, name, secret_ref)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(platform, variant, remote_id) DO UPDATE
             SET name = excluded.name, secret_ref = excluded.secret_ref, expires_at = NULL
             RETURNING id",
            params![platform, variant, remote_id, name, secret_ref],
            |row| row.get(0),
        )?)
    }

    pub fn social_accounts(&self) -> Result<Vec<Account>> {
        let db = self.db()?;
        let mut statement = db.prepare(&format!("{ACCOUNT} ORDER BY id"))?;
        let rows = statement
            .query_map([], account)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter().map(typed).collect()
    }

    pub fn social_account(&self, account_id: i64) -> Result<Account> {
        let row = self
            .db()?
            .query_row(&format!("{ACCOUNT} WHERE id = ?"), [account_id], account)
            .optional()?
            .ok_or(NO_ACCOUNT)?;
        typed(row)
    }

    pub fn set_account_expiry(&self, account_id: i64, expires_at: Option<i64>) -> Result<()> {
        self.db()?.execute(
            "UPDATE connected_accounts SET expires_at = ?2 WHERE id = ?1",
            params![account_id, expires_at],
        )?;
        Ok(())
    }

    pub fn delete_social_account(&self, account_id: i64) -> Result<()> {
        self.db()?
            .execute("DELETE FROM connected_accounts WHERE id = ?", [account_id])?;
        Ok(())
    }

    /// Validates a draft against its account's platform and stores it. Nothing is sent.
    pub fn create_publish_job(&self, draft: &DraftInput) -> Result<PublishJob> {
        let account = self.social_account(draft.account_id)?;
        let db = self.db()?;
        let asset_kind: Option<String> = match draft.asset_id {
            Some(id) => db
                .query_row(
                    "SELECT kind FROM assets WHERE id = ? AND available = 1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?,
            None => None,
        };
        if let Some(id) = draft.render_job_id
            && !db.query_row(
                "SELECT EXISTS(SELECT 1 FROM render_jobs WHERE id = ? AND status = 'done')",
                [id],
                |row| row.get::<_, bool>(0),
            )?
        {
            return Err(StudioError::Input("Chỉ đăng được video đã xuất xong."));
        }
        check_draft(
            account.platform,
            &account.variant,
            draft,
            asset_kind.as_deref(),
        )?;
        let media = match (&draft.media_url, draft.asset_id, draft.render_job_id) {
            (Some(_), ..) => "url",
            (_, Some(_), _) => "asset",
            (.., Some(_)) => "render",
            _ => "none",
        };
        let id: i64 = db.query_row(
            "INSERT INTO publishing_jobs
             (account_id, format, caption, title, privacy, media, media_url, asset_id, render_job_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![
                draft.account_id,
                draft.format,
                draft.caption,
                draft.title.trim(),
                draft.privacy,
                media,
                draft.media_url,
                draft.asset_id,
                draft.render_job_id
            ],
            |row| row.get(0),
        )?;
        Ok(db.query_row(&format!("{JOB} WHERE j.id = ?"), [id], job)?)
    }

    pub fn publish_jobs(&self) -> Result<Vec<PublishJob>> {
        let db = self.db()?;
        let mut statement = db.prepare(&format!("{JOB} ORDER BY j.id DESC LIMIT 50"))?;
        let rows = statement.query_map([], job)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn publish_job(&self, job_id: i64) -> Result<PublishJob> {
        self.db()?
            .query_row(&format!("{JOB} WHERE j.id = ?"), [job_id], job)
            .optional()?
            .ok_or(NO_JOB)
    }

    /// Records the user's approval and claims the job for one worker. Returns false when
    /// the job is not waiting, which is what stops a second click from posting twice.
    pub fn begin_publish(&self, job_id: i64) -> Result<bool> {
        Ok(self.db()?.execute(
            &format!(
                "UPDATE publishing_jobs SET status = 'publishing', error = NULL, approved_at = {NOW}
                 WHERE id = ? AND status IN ('draft', 'failed')"
            ),
            [job_id],
        )? == 1)
    }

    pub fn publish_task(&self, job_id: i64) -> Result<PublishTask> {
        self.db()?
            .query_row(
                "SELECT account_id, format, caption, title, privacy, media, media_url, asset_id,
                        render_job_id, remote_ref
                 FROM publishing_jobs WHERE id = ? AND status = 'publishing'",
                [job_id],
                |row| {
                    Ok(PublishTask {
                        account_id: row.get(0)?,
                        format: row.get(1)?,
                        caption: row.get(2)?,
                        title: row.get(3)?,
                        privacy: row.get(4)?,
                        media: row.get(5)?,
                        media_url: row.get(6)?,
                        asset_id: row.get(7)?,
                        render_job_id: row.get(8)?,
                        remote_ref: row.get(9)?,
                    })
                },
            )
            .optional()?
            .ok_or(NO_JOB)
    }

    pub fn set_publish_ref(&self, job_id: i64, reference: &str) -> Result<()> {
        self.db()?.execute(
            "UPDATE publishing_jobs SET remote_ref = ?2 WHERE id = ?1",
            params![job_id, reference],
        )?;
        Ok(())
    }

    pub fn finish_publish(
        &self,
        job_id: i64,
        remote_id: Option<&str>,
        permalink: Option<&str>,
    ) -> Result<()> {
        self.db()?.execute(
            &format!(
                "UPDATE publishing_jobs SET status = 'published', error = NULL, remote_id = ?2,
                 permalink = ?3, published_at = {NOW} WHERE id = ?1 AND status = 'publishing'"
            ),
            params![job_id, remote_id, permalink],
        )?;
        Ok(())
    }

    pub fn fail_publish(&self, job_id: i64, error: &str) -> Result<()> {
        self.db()?.execute(
            "UPDATE publishing_jobs SET status = 'failed', error = ?2
             WHERE id = ?1 AND status = 'publishing'",
            params![job_id, error],
        )?;
        Ok(())
    }

    /// Removes a local draft or failed job. Published jobs stay as the audit trail.
    pub fn delete_publish_job(&self, job_id: i64) -> Result<()> {
        let removed = self.db()?.execute(
            "DELETE FROM publishing_jobs WHERE id = ? AND status IN ('draft', 'failed')",
            [job_id],
        )?;
        if removed == 0 {
            return Err(StudioError::Input(
                "Chỉ xóa được bản nháp hoặc bài đăng lỗi.",
            ));
        }
        Ok(())
    }

    pub fn mark_remote_removed(&self, account_id: i64, remote_id: &str) -> Result<()> {
        self.db()?.execute(
            "UPDATE publishing_jobs SET status = 'removed'
             WHERE account_id = ?1 AND remote_id = ?2 AND status = 'published'",
            params![account_id, remote_id],
        )?;
        Ok(())
    }

    pub fn update_remote_caption(
        &self,
        account_id: i64,
        remote_id: &str,
        caption: &str,
    ) -> Result<()> {
        self.db()?.execute(
            "UPDATE publishing_jobs SET caption = ?3
             WHERE account_id = ?1 AND remote_id = ?2 AND status = 'published'",
            params![account_id, remote_id, caption],
        )?;
        Ok(())
    }
}
