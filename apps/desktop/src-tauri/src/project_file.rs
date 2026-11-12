use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    library::{authorized_asset, authorized_file},
    model::{Project, Result, StudioError},
    store::Store,
    timeline::TimelineSnapshot,
};

const FORMAT: &str = "dt-edit-project-1";
const MAX_BYTES: usize = 32 * 1024 * 1024;
const INVALID: StudioError = StudioError::Input("Tệp .dtedit không hợp lệ hoặc thiếu dữ liệu.");

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    format: String,
    name: String,
    snapshot: TimelineSnapshot,
    assets: BTreeMap<i64, PathBuf>,
    luts: BTreeMap<i64, SavedLut>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedLut {
    name: String,
    cube: String,
}

fn file_location(path: &Path) -> Result<(PathBuf, &Path)> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("dtedit"))
    {
        return Err(INVALID);
    }
    let parent = dunce::canonicalize(path.parent().ok_or(INVALID)?)?;
    let name = Path::new(path.file_name().ok_or(INVALID)?);
    Ok((parent, name))
}

fn media_ids(snapshot: &TimelineSnapshot) -> BTreeSet<i64> {
    snapshot
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .flat_map(|clip| {
            std::iter::once(clip.asset_id).chain(
                clip.look
                    .transition
                    .as_ref()
                    .map(|transition| transition.from_asset_id),
            )
        })
        .collect()
}

fn lut_ids(snapshot: &TimelineSnapshot) -> BTreeSet<i64> {
    snapshot
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .map(|clip| &clip.look)
        .chain(snapshot.adjustments.iter().map(|layer| &layer.look))
        .filter_map(|look| look.lut)
        .collect()
}

pub fn save(store: &Store, project: &Project, path: &Path) -> Result<PathBuf> {
    let (parent, name) = file_location(path)?;
    let path = parent.join(name);
    let existing = path.symlink_metadata().is_ok();
    if existing {
        authorized_file(&parent, name)?;
    }
    let snapshot = store.snapshot(project.id)?;
    let mut assets = BTreeMap::new();
    for id in media_ids(&snapshot) {
        let source = store.source(id, false)?.ok_or(StudioError::Input(
            "Có nguồn dự án đã mất quyền hoặc không còn trong thư viện.",
        ))?;
        assets.insert(id, authorized_asset(&source)?.0);
    }
    let lut_names = store.luts()?;
    let mut luts = BTreeMap::new();
    let mut lut_bytes = 0;
    for id in lut_ids(&snapshot) {
        let name = lut_names
            .iter()
            .find(|lut| lut.id == id)
            .ok_or(INVALID)?
            .name
            .clone();
        let cube = store.lut(id)?;
        lut_bytes += cube.len();
        if lut_bytes > MAX_BYTES {
            return Err(StudioError::Input("LUT trong dự án vượt giới hạn 32 MB."));
        }
        luts.insert(id, SavedLut { name, cube });
    }
    let document = Document {
        format: FORMAT.into(),
        name: project.name.clone(),
        snapshot,
        assets,
        luts,
    };
    let bytes = serde_json::to_vec(&document).map_err(|_| INVALID)?;
    if bytes.len() > MAX_BYTES {
        return Err(StudioError::Input("Tệp dự án vượt giới hạn 32 MB."));
    }
    let mut staged = tempfile::NamedTempFile::new_in(&parent)?;
    staged.write_all(&bytes)?;
    staged.as_file().sync_all()?;
    if existing {
        staged.persist(&path)
    } else {
        staged.persist_noclobber(&path)
    }
    .map_err(|error| error.error)?;
    Ok(path)
}

pub fn open(store: &Store, path: &Path) -> Result<Project> {
    let (parent, name) = file_location(path)?;
    let (path, metadata) = authorized_file(&parent, name)?;
    if metadata.len() > MAX_BYTES as u64 {
        return Err(INVALID);
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BYTES {
        return Err(INVALID);
    }
    let mut document: Document = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
    if document.format != FORMAT {
        return Err(INVALID);
    }
    crate::timeline::check_version(&document.snapshot)?;
    let mut assets = BTreeMap::new();
    for id in media_ids(&document.snapshot) {
        let path = document.assets.get(&id).ok_or(INVALID)?;
        let local = store.asset_at_path(path)?.ok_or_else(|| {
            StudioError::Message(format!(
                "Hãy nhập lại nguồn '{}' vào thư viện từ vị trí gốc rồi mở dự án.",
                path.file_name().unwrap_or_default().to_string_lossy(),
            ))
        })?;
        let source = store.source(local, false)?.ok_or(INVALID)?;
        if authorized_asset(&source)?.0 != *path {
            return Err(INVALID);
        }
        assets.insert(id, local);
    }
    let mut luts = BTreeMap::new();
    for id in lut_ids(&document.snapshot) {
        let lut = document.luts.get(&id).ok_or(INVALID)?;
        if lut.name.is_empty()
            || lut.name.chars().count() > 180
            || lut.name.chars().any(char::is_control)
        {
            return Err(INVALID);
        }
        crate::voice::validate_cube(&lut.cube)?;
        luts.insert(id, store.find_or_insert_lut(&lut.name, &lut.cube)?);
    }
    for clip in document
        .snapshot
        .tracks
        .iter_mut()
        .flat_map(|track| &mut track.clips)
    {
        clip.asset_id = assets[&clip.asset_id];
        if let Some(transition) = &mut clip.look.transition {
            transition.from_asset_id = assets[&transition.from_asset_id];
        }
        clip.look.lut = clip.look.lut.map(|id| luts[&id]);
    }
    for layer in &mut document.snapshot.adjustments {
        layer.look.lut = layer.look.lut.map(|id| luts[&id]);
    }
    store.create_project_with_timeline(&document.name, Some(&document.snapshot))
}
