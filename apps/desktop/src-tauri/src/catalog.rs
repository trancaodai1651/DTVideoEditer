use std::{fs, io::Write, path::Path};

use serde::Serialize;

use crate::{
    library::authorized_file,
    model::{Asset, Result, StudioError},
    probe::Metadata,
    store::{IndexEntry, Store},
};

struct Resource {
    file: &'static str,
    title: &'static str,
    group: &'static str,
    data: &'static [u8],
    duration_ms: Option<i64>,
}

macro_rules! resource {
    ($file:literal, $title:literal, $group:literal, $duration:expr) => {
        Resource {
            file: $file,
            title: $title,
            group: $group,
            data: include_bytes!(concat!("../assets/studio/", $file)),
            duration_ms: $duration,
        }
    };
}

const RESOURCES: &[Resource] = &[
    resource!("soft-steps.wav", "Bước chân nhẹ", "music", Some(8000)),
    resource!("city-pulse.wav", "Nhịp phố", "music", Some(8000)),
    resource!("bright-chime.wav", "Chuông sáng", "sound", Some(750)),
    resource!("pop-click.wav", "Nút bật", "sound", Some(250)),
    resource!("sweep.wav", "Lướt nhanh", "sound", Some(500)),
    resource!("gold-star.png", "Sao vàng", "sticker", None),
    resource!("teal-arrow.png", "Mũi tên", "sticker", None),
    resource!("pink-heart.png", "Tim hồng", "sticker", None),
    resource!("focus-ring.png", "Vòng đánh dấu", "sticker", None),
    resource!("violet-bubble.png", "Bong bóng thoại", "sticker", None),
    resource!("amber-spark.png", "Tia sáng", "sticker", None),
];

#[derive(Serialize)]
pub struct CatalogItem {
    pub title: &'static str,
    pub group: &'static str,
    pub asset: Asset,
}

pub fn load(store: &Store, data_dir: &Path) -> Result<Vec<CatalogItem>> {
    let root = dunce::canonicalize(data_dir)?.join("stock-v1");
    fs::create_dir_all(&root)?;
    if dunce::canonicalize(&root)? != root {
        return Err(StudioError::Input(
            "Thư mục tài nguyên tích hợp không hợp lệ.",
        ));
    }
    let mut entries = Vec::with_capacity(RESOURCES.len());
    for resource in RESOURCES {
        let path = root.join(resource.file);
        if !path.exists() {
            let mut temporary = tempfile::NamedTempFile::new_in(&root)?;
            temporary.write_all(resource.data)?;
            temporary
                .persist_noclobber(&path)
                .map_err(|error| error.error)?;
        }
        let (checked, metadata) = authorized_file(&root, Path::new(resource.file))?;
        if metadata.len() != resource.data.len() as u64 || fs::read(checked)? != resource.data {
            return Err(StudioError::Input(
                "Một tài nguyên tích hợp đã bị thay đổi.",
            ));
        }
        let image = resource.group == "sticker";
        entries.push(IndexEntry {
            relative_path: resource.file.to_owned(),
            bytes: metadata.len() as i64,
            modified: "stock-v1".to_owned(),
            metadata: Some(Metadata {
                kind: if image { "image" } else { "audio" },
                duration_ms: resource.duration_ms,
                width: image.then_some(192),
                height: image.then_some(192),
                codec: Some(if image { "png" } else { "pcm_s16le" }.into()),
                frame_rate: None,
                thumbnail: None,
            }),
        });
    }
    let root_text = root.to_str().ok_or(StudioError::Input(
        "Đường dẫn tài nguyên không hỗ trợ Unicode.",
    ))?;
    let grant = store.grant(root_text)?;
    store.apply_scan(grant, &entries, false)?;
    Ok(store
        .assets(Some(grant), 0)?
        .items
        .into_iter()
        .filter_map(|asset| {
            let resource = RESOURCES
                .iter()
                .find(|resource| asset.relative_path == resource.file)?;
            Some(CatalogItem {
                title: resource.title,
                group: resource.group,
                asset,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_stock_assets_once_and_preserves_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
        let first = load(&store, dir.path()).unwrap();
        let second = load(&store, dir.path()).unwrap();
        assert_eq!(first.len(), RESOURCES.len());
        assert_eq!(
            first.iter().map(|item| item.asset.id).collect::<Vec<_>>(),
            second.iter().map(|item| item.asset.id).collect::<Vec<_>>()
        );
        assert!(
            first
                .iter()
                .any(|item| item.group == "music" && item.asset.duration_ms == Some(8000))
        );
        assert!(
            first
                .iter()
                .any(|item| item.group == "sticker" && item.asset.width == Some(192))
        );
    }
}
