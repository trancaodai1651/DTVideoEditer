import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, desktop, fileName } from "./desktop";
import type {
  Platform, PostFormat, PublishJob, PublishOptions, RemotePost, RenderJob, SocialAccount,
} from "./desktop";
import { Icon } from "./Icon";
import type { Selection } from "./MediaPanels";
import { publishText as t, vi } from "./vi";

type Source = "url" | "asset" | "render";
type Variant = "" | "instagram_login" | "facebook_login";
const PLATFORMS: Platform[] = ["threads", "facebook", "instagram", "tiktok"];
const EMPTY_SECRET = { accessToken: "", refreshToken: "", clientKey: "", clientSecret: "" };

function accountLabel(account: SocialAccount) {
  return `${t.platform[account.platform]} · ${account.name}`;
}

function when(value: string | null) {
  if (!value) return "";
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function PublishPanel({ selection, exports, notify }: {
  selection: Selection | null;
  exports: RenderJob[];
  notify: (text: string, error: boolean) => void;
}) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [pending, setPending] = useState("");
  const [platform, setPlatform] = useState<Platform>("threads");
  const [variant, setVariant] = useState<Variant>("");
  const [secret, setSecret] = useState(EMPTY_SECRET);
  const [forgetId, setForgetId] = useState<number | null>(null);

  const [accountId, setAccountId] = useState<number | null>(null);
  const [format, setFormat] = useState<PostFormat>("text");
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [options, setOptions] = useState<PublishOptions | null>(null);
  const [source, setSource] = useState<Source>("url");
  const [mediaUrl, setMediaUrl] = useState("");
  const [renderId, setRenderId] = useState<number | null>(null);

  const [remoteId, setRemoteId] = useState<number | null>(null);
  const [posts, setPosts] = useState<RemotePost[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];
  const rules = account?.capabilities;
  const activeFormat = rules?.formats.includes(format) ? format : rules?.formats[0] ?? "text";
  const wantsMedia = activeFormat !== "text";
  const done = exports.filter((job) => job.status === "done");
  const sources: Source[] = !rules || !wantsMedia ? [] : [
    ...(rules.urlMedia.includes(activeFormat) ? ["url" as const] : []),
    ...(rules.localMedia.includes(activeFormat) ? ["asset" as const] : []),
    ...(rules.localMedia.includes(activeFormat) && activeFormat !== "image" ? ["render" as const] : []),
  ];
  const activeSource = sources.includes(source) ? source : sources[0];
  const assetFits = !!selection && (activeFormat === "image" ? selection.kind === "image" : selection.kind === "video");
  const activeRender = done.find((job) => job.id === renderId) ?? done[0];
  const mediaReady = !wantsMedia || (activeSource === "url" ? mediaUrl.trim().startsWith("https://")
    : activeSource === "asset" ? assetFits : !!activeRender);
  const units = account?.platform === "tiktok" ? caption.length : [...caption].length;
  const remote = accounts.find((item) => item.id === remoteId) ?? accounts[0];
  const publishing = jobs.some((job) => job.status === "publishing");
  const locked = !!pending || !desktop;

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void Promise.all([api.accounts(), api.publishJobs()]).then(([saved, list]) => {
      if (!current) return;
      setAccounts(saved);
      setJobs(list);
    }).catch((error: unknown) => notify(String(error), true));
    return () => { current = false; };
  }, [notify]);

  useEffect(() => {
    if (!publishing) return;
    const timer = setInterval(() => {
      void api.publishJobs().then(setJobs).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [publishing]);

  const tiktokId = account?.platform === "tiktok" ? account.id : null;
  useEffect(() => {
    if (tiktokId === null) return;
    let current = true;
    void api.publishOptions(tiktokId).then((loaded) => {
      if (current) setOptions(loaded);
    }).catch((error: unknown) => {
      if (current) notify(String(error), true);
    });
    return () => { current = false; };
  }, [tiktokId, notify]);

  async function run(label: string, action: () => Promise<void>) {
    if (locked) return;
    setPending(label);
    try {
      await action();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setPending("");
    }
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(t.connecting, async () => {
      const added = await api.connectAccount({
        platform, variant: platform === "instagram" ? variant || "instagram_login" : "",
        accessToken: secret.accessToken,
        refreshToken: platform === "tiktok" ? secret.refreshToken : null,
        clientKey: platform === "tiktok" ? secret.clientKey : null,
        clientSecret: platform === "tiktok" ? secret.clientSecret : null,
      });
      setSecret(EMPTY_SECRET);
      setAccounts(await api.accounts());
      setAccountId(added.id);
      notify(t.connected(accountLabel(added)), false);
    });
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    void run(vi.working, async () => {
      await api.createDraft({
        accountId: account.id, format: activeFormat, caption, title: rules?.edit && wantsMedia ? title : "",
        privacy: rules?.privacy ? privacy : "",
        mediaUrl: wantsMedia && activeSource === "url" ? mediaUrl.trim() : null,
        assetId: wantsMedia && activeSource === "asset" && selection ? selection.assetId : null,
        renderJobId: wantsMedia && activeSource === "render" && activeRender ? activeRender.id : null,
      });
      setJobs(await api.publishJobs());
      setCaption("");
      setTitle("");
      setMediaUrl("");
      notify(t.draftSaved, false);
    });
  }

  function approve(job: PublishJob) {
    void run(t.waitingApproval, async () => {
      const next = await api.approvePublish(job.id);
      setJobs(await api.publishJobs());
      if (next.status === "publishing") notify(t.sending, false);
    });
  }

  function loadPosts(target: SocialAccount) {
    void run(t.loadingPosts, async () => {
      setEditing(null);
      setPosts(await api.remotePosts(target.id));
    });
  }

  function removePost(target: SocialAccount, post: RemotePost) {
    void run(t.waitingApproval, async () => {
      if (!await api.deleteRemotePost(target.id, post.id)) return;
      setPosts((list) => list?.filter((item) => item.id !== post.id) ?? null);
      setJobs(await api.publishJobs());
      notify(t.postDeleted, false);
    });
  }

  function saveEdit(target: SocialAccount) {
    if (!editing) return;
    const { id, text } = editing;
    void run(t.waitingApproval, async () => {
      if (!await api.editRemotePost(target.id, id, text)) return;
      setPosts((list) => list?.map((item) => (item.id === id ? { ...item, text } : item)) ?? null);
      setJobs(await api.publishJobs());
      setEditing(null);
      notify(t.postEdited, false);
    });
  }

  return <>
    {pending && <p className="notice"><span className="spinner" aria-hidden="true" />{pending}</p>}

    <section className="panel settings-panel" aria-labelledby="accounts-heading">
      <div className="panel-head"><div>
        <div className="panel-title"><Icon name="shield" /><h2 id="accounts-heading">{t.accounts}</h2></div>
        <p>{t.accountsHint}</p>
      </div></div>
      {!accounts.length && <p className="setting-empty">{t.noAccounts}</p>}
      {accounts.map((item) => <div className="setting-item" key={item.id}>
        <div className="folder-row">
          <span className="empty-icon"><Icon name="link" /></span>
          <div className="folder-copy">
            <strong>{accountLabel(item)}</strong>
            <p>{[item.variant && t.variant[item.variant as Exclude<Variant, "">], `ID ${item.remoteId}`,
              item.expiresAt && t.expires(when(String(item.expiresAt)))].filter(Boolean).join(" · ")}</p>
          </div>
          {item.capabilities.refresh && <button type="button" className="button secondary" disabled={locked}
            onClick={() => void run(vi.working, async () => {
              await api.refreshToken(item.id);
              setAccounts(await api.accounts());
              notify(t.tokenRefreshed, false);
            })}>{t.refreshToken}</button>}
          <button type="button" className="button secondary danger" disabled={locked}
            onClick={() => setForgetId(item.id)}>{t.disconnect}</button>
        </div>
        {forgetId === item.id && <div className="confirm-row">
          <p>{t.disconnectBody}</p>
          <button type="button" className="button secondary" disabled={locked} onClick={() => setForgetId(null)}>{vi.cancel}</button>
          <button type="button" className="button secondary danger" disabled={locked}
            onClick={() => void run(vi.working, async () => {
              await api.disconnectAccount(item.id);
              setForgetId(null);
              setPosts(null);
              setAccounts(await api.accounts());
              setJobs(await api.publishJobs());
            })}>{t.disconnectConfirm}</button>
        </div>}
      </div>)}
      <form className="publish-form" onSubmit={connect} autoComplete="off">
        <label>{t.platformLabel}
          <select value={platform} disabled={locked} onChange={(event) => setPlatform(event.target.value as Platform)}>
            {PLATFORMS.map((item) => <option key={item} value={item}>{t.platform[item]}</option>)}
          </select>
        </label>
        {platform === "instagram" && <label>{t.variantLabel}
          <select value={variant || "instagram_login"} disabled={locked} onChange={(event) => setVariant(event.target.value as Variant)}>
            <option value="instagram_login">{t.variant.instagram_login}</option>
            <option value="facebook_login">{t.variant.facebook_login}</option>
          </select>
        </label>}
        <label className="wide">{t.token}
          <input type="password" required value={secret.accessToken} disabled={locked} spellCheck={false}
            onChange={(event) => setSecret({ ...secret, accessToken: event.target.value })} />
        </label>
        {platform === "tiktok" && (["refreshToken", "clientKey", "clientSecret"] as const).map((field) =>
          <label key={field}>{t.secretField[field]}
            <input type="password" value={secret[field]} disabled={locked} spellCheck={false}
              onChange={(event) => setSecret({ ...secret, [field]: event.target.value })} />
          </label>)}
        <p className="wide form-hint">{t.connectHint[platform === "instagram" ? variant || "instagram_login" : platform]}</p>
        <button type="submit" className="button primary" disabled={locked || !secret.accessToken.trim()}>
          <Icon name="link" />{t.connect}
        </button>
      </form>
    </section>

    <section className="panel settings-panel" aria-labelledby="compose-heading">
      <div className="panel-head"><div>
        <div className="panel-title"><Icon name="send" /><h2 id="compose-heading">{t.compose}</h2></div>
        <p>{t.composeHint}</p>
      </div></div>
      {account && rules ? <form className="publish-form" onSubmit={saveDraft}>
        <label>{t.account}
          <select value={account.id} disabled={locked} onChange={(event) => { setAccountId(Number(event.target.value)); setPrivacy(""); }}>
            {accounts.map((item) => <option key={item.id} value={item.id}>{accountLabel(item)}</option>)}
          </select>
        </label>
        <label>{t.format}
          <select value={activeFormat} disabled={locked} onChange={(event) => setFormat(event.target.value as PostFormat)}>
            {rules.formats.map((item) => <option key={item} value={item}>{t.formats[item]}</option>)}
          </select>
        </label>
        <label className="wide">{t.caption}
          <textarea rows={4} value={caption} disabled={locked} onChange={(event) => setCaption(event.target.value)} />
          <small className={units > rules.captionLimit ? "over" : ""}>{units} / {rules.captionLimit}</small>
        </label>
        {rules.edit && wantsMedia && activeFormat !== "image" && <label className="wide">{t.title}
          <input value={title} maxLength={255} disabled={locked} onChange={(event) => setTitle(event.target.value)} />
        </label>}
        {rules.privacy && <label className="wide">{t.privacy}
          <select value={privacy} required disabled={locked} onChange={(event) => setPrivacy(event.target.value)}>
            <option value="">{t.privacyChoose}</option>
            {(options?.privacyLevels ?? []).map((level) =>
              <option key={level} value={level}>{t.privacyLevel[level as keyof typeof t.privacyLevel] ?? level}</option>)}
          </select>
          <small>{t.tiktokNote}</small>
        </label>}
        {wantsMedia && <fieldset className="wide">
          <legend>{t.media}</legend>
          {sources.map((item) => <label className="radio" key={item}>
            <input type="radio" name="media-source" checked={activeSource === item} disabled={locked}
              onChange={() => setSource(item)} />{t.source[item]}
          </label>)}
          {activeSource === "url" && <input type="url" placeholder="https://" value={mediaUrl} disabled={locked}
            aria-label={t.source.url} onChange={(event) => setMediaUrl(event.target.value)} />}
          {activeSource === "asset" && <p className="form-hint">
            {assetFits && selection ? fileName(selection.relativePath) : t.pickAsset(t.formats[activeFormat])}</p>}
          {activeSource === "render" && (done.length ? <select value={activeRender?.id} disabled={locked}
            aria-label={t.source.render} onChange={(event) => setRenderId(Number(event.target.value))}>
            {done.map((job) => <option key={job.id} value={job.id}>{fileName(job.outputPath)}</option>)}
          </select> : <p className="form-hint">{t.noExports}</p>)}
        </fieldset>}
        <button type="submit" className="button secondary"
          disabled={locked || !mediaReady || units > rules.captionLimit || (!wantsMedia && !caption.trim()) || (rules.privacy && !privacy)}>
          <Icon name="plus" />{t.saveDraft}
        </button>
      </form> : <p className="setting-empty">{t.needAccount}</p>}

      {jobs.length > 0 && <ul className="render-jobs" aria-label={t.jobs}>
        {jobs.map((job) => <li key={job.id} className={`render-job ${job.status === "published" ? "done" : job.status}`}>
          <div className="render-copy">
            <strong>{t.status[job.status]} · {t.platform[job.platform]} · {job.accountName}</strong>
            <span title={job.caption}>{t.formats[job.format]}{job.mediaLabel ? ` · ${fileName(job.mediaLabel)}` : ""}
              {job.caption ? ` · ${job.caption}` : ""}</span>
            {job.permalink && <span className="selectable">{job.permalink}</span>}
            {job.error && <span className="render-error">{job.error}</span>}
          </div>
          {job.status === "publishing" && <progress aria-label={t.sending} />}
          {(job.status === "draft" || job.status === "failed") && <>
            <button type="button" className="button primary compact" disabled={locked} onClick={() => approve(job)}>
              <Icon name="send" size={15} />{job.status === "failed" ? vi.retry : t.approve}
            </button>
            <button type="button" className="button secondary compact danger" disabled={locked}
              onClick={() => void run(vi.working, async () => {
                await api.deleteDraft(job.id);
                setJobs(await api.publishJobs());
              })}>{t.discard}</button>
          </>}
        </li>)}
      </ul>}
    </section>

    {remote && <section className="panel settings-panel" aria-labelledby="remote-heading">
      <div className="panel-head"><div>
        <div className="panel-title"><Icon name="library" /><h2 id="remote-heading">{t.remote}</h2></div>
        <p>{t.remoteHint}</p>
      </div></div>
      <div className="tools-row">
        <select aria-label={t.account} value={remote.id} disabled={locked}
          onChange={(event) => { setRemoteId(Number(event.target.value)); setPosts(null); }}>
          {accounts.map((item) => <option key={item.id} value={item.id}>{accountLabel(item)}</option>)}
        </select>
        <button type="button" className="button secondary" disabled={locked} onClick={() => loadPosts(remote)}>
          <Icon name="refresh" />{t.loadPosts}
        </button>
      </div>
      {posts && !posts.length && <p className="setting-empty">{t.noPosts}</p>}
      {posts && posts.length > 0 && <ul className="render-jobs">
        {posts.map((post) => <li key={post.id} className="render-job">
          <div className="render-copy">
            {editing?.id === post.id
              ? <textarea rows={3} value={editing.text} disabled={locked} aria-label={t.caption}
                onChange={(event) => setEditing({ id: post.id, text: event.target.value })} />
              : <strong className="post-text">{post.text || t.noText}</strong>}
            <span>{[post.kind, when(post.createdAt)].filter(Boolean).join(" · ")}</span>
            {post.permalink && <span className="selectable">{post.permalink}</span>}
          </div>
          {editing?.id === post.id ? <>
            <button type="button" className="button primary compact" disabled={locked || !editing.text.trim()}
              onClick={() => saveEdit(remote)}>{t.saveEdit}</button>
            <button type="button" className="button secondary compact" disabled={locked} onClick={() => setEditing(null)}>{vi.cancel}</button>
          </> : <>
            {remote.capabilities.edit && <button type="button" className="button secondary compact" disabled={locked}
              onClick={() => setEditing({ id: post.id, text: post.text })}>{t.edit}</button>}
            {remote.capabilities.delete && <button type="button" className="button secondary compact danger" disabled={locked}
              onClick={() => removePost(remote, post)}><Icon name="trash" size={15} />{t.deletePost}</button>}
          </>}
        </li>)}
      </ul>}
      {!remote.capabilities.delete && <p className="setting-empty">{t.noDelete}</p>}
    </section>}
  </>;
}
