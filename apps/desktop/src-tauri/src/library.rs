use std::{
    fs::{self, Metadata as FileMetadata},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use walkdir::{DirEntry, WalkDir};

use crate::model::Asset;
use crate::{
    model::{Result, ScanReport, StudioError},
    probe::{MediaFormat, MediaProbe},
    store::{AssetSource, IndexEntry, Store},
};
use std::collections::{HashMap, HashSet};

const MAX_MEDIA: usize = 600;
const MAX_ENTRIES: usize = 10_000;
const MAX_DEPTH: usize = 12;
pub const MAX_IMPORT: usize = 100;

pub fn selected_root(path: &Path) -> Result<PathBuf> {
    let root = dunce::canonicalize(path)?;
    check_root(&root)?;
    Ok(root)
}

fn check_root(root: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(root)?;
    if !root.is_absolute()
        || !metadata.is_dir()
        || is_link(&metadata)
        || dunce::canonicalize(root)? != root
    {
        return Err(StudioError::Input(
            "Đường dẫn thư mục đã thay đổi. Hãy cấp quyền lại.",
        ));
    }
    Ok(())
}

pub fn authorized_file(root: &Path, relative: &Path) -> Result<(PathBuf, FileMetadata)> {
    check_root(root)?;
    checked_file(root, relative)
}

pub fn authorized_asset(source: &AssetSource) -> Result<(PathBuf, FileMetadata)> {
    let root = Path::new(&source.root);
    if source.file_only {
        if root.file_name() != Some(source.relative_path.as_ref()) {
            return Err(StudioError::Input("Tệp nằm ngoài quyền đã cấp."));
        }
        return check_exact_file(root);
    }
    authorized_file(root, Path::new(&source.relative_path))
}

fn check_exact_file(path: &Path) -> Result<(PathBuf, FileMetadata)> {
    let metadata = fs::symlink_metadata(path)?;
    if !path.is_absolute()
        || !metadata.is_file()
        || is_link(&metadata)
        || dunce::canonicalize(path)? != path
    {
        return Err(StudioError::Input(
            "Tệp đã thay đổi vị trí hoặc là liên kết.",
        ));
    }
    Ok((path.to_owned(), metadata))
}

fn exact_entry(
    path: &Path,
    probe: &impl MediaProbe,
    known: &HashMap<String, (i64, String)>,
) -> Option<IndexEntry> {
    let (_, metadata) = check_exact_file(path).ok()?;
    let relative = path.file_name()?.to_str()?;
    index_entry(
        path,
        relative,
        metadata,
        &MediaFormat::for_path(path)?,
        probe,
        known,
    )
}

#[derive(serde::Serialize)]
pub struct ImportedFiles {
    pub assets: Vec<Asset>,
    pub skipped: usize,
}

pub fn import_files(
    store: &Store,
    paths: &[PathBuf],
    probe: &impl MediaProbe,
) -> Result<ImportedFiles> {
    let mut result = ImportedFiles {
        assets: Vec::new(),
        skipped: paths.len().saturating_sub(MAX_IMPORT),
    };
    let mut seen = HashSet::new();
    for selected in paths.iter().take(MAX_IMPORT) {
        let path = fs::symlink_metadata(selected)
            .ok()
            .filter(|data| data.is_file() && !is_link(data))
            .and_then(|_| dunce::canonicalize(selected).ok());
        let Some(path) = path else {
            result.skipped += 1;
            continue;
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let Some(root) = path.to_str() else {
            result.skipped += 1;
            continue;
        };
        let known = match store.file_grant(root)? {
            Some(id) => store.fingerprints(id, probe.generates_thumbnails())?,
            None => HashMap::new(),
        };
        let Some(entry) = exact_entry(&path, probe, &known) else {
            result.skipped += 1;
            continue;
        };
        check_exact_file(&path)?;
        let id = store.register_file(root, &entry)?;
        result.assets.extend(store.assets(Some(id), 0)?.items);
    }
    Ok(result)
}

fn checked_file(root: &Path, relative: &Path) -> Result<(PathBuf, FileMetadata)> {
    let forbidden = StudioError::Input("Tệp nằm ngoài thư mục hoặc là liên kết.");
    let mut path = root.to_path_buf();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(forbidden);
        };
        path.push(name);
        let metadata = fs::symlink_metadata(&path)?;
        if is_link(&metadata) {
            return Err(forbidden);
        }
        if components.peek().is_none() {
            let canonical = dunce::canonicalize(&path)?;
            if metadata.is_file() && canonical == path && canonical.starts_with(root) {
                return Ok((canonical, metadata));
            }
            return Err(forbidden);
        }
        if !metadata.is_dir() {
            return Err(forbidden);
        }
    }
    Err(forbidden)
}

fn is_link(metadata: &FileMetadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0; // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

fn traversable(entry: &DirEntry) -> bool {
    entry.depth() == 0
        || (!entry.file_type().is_symlink()
            && !fs::symlink_metadata(entry.path()).is_ok_and(|metadata| is_link(&metadata)))
}

pub fn scan(store: &Store, folder_id: i64, probe: &impl MediaProbe) -> Result<ScanReport> {
    let (scope, file_only) = store.scope(folder_id)?;
    let root = PathBuf::from(scope);
    let known = store.fingerprints(folder_id, probe.generates_thumbnails())?;
    if file_only {
        let entry = exact_entry(&root, probe, &known);
        let report = ScanReport {
            indexed: usize::from(entry.as_ref().is_some_and(|entry| entry.metadata.is_some())),
            reused: usize::from(entry.as_ref().is_some_and(|entry| entry.metadata.is_none())),
            skipped: usize::from(entry.is_none()),
            partial: false,
        };
        store.apply_scan(folder_id, entry.as_slice(), false)?;
        return Ok(report);
    }
    check_root(&root)?;
    let mut entries = Vec::new();
    let mut candidates = 0;
    let mut report = ScanReport::default();

    let walker = WalkDir::new(&root)
        .min_depth(1)
        .max_depth(MAX_DEPTH)
        .max_open(MAX_DEPTH + 1)
        .follow_links(false)
        .follow_root_links(false)
        .into_iter()
        .filter_entry(traversable);
    for (seen, item) in walker.enumerate() {
        if seen == MAX_ENTRIES {
            report.partial = true;
            break;
        }
        let Ok(entry) = item else {
            report.skipped += 1;
            report.partial = true;
            continue;
        };
        if entry.file_type().is_dir() && entry.depth() == MAX_DEPTH {
            report.partial = true;
        }
        let Some(format) = entry
            .file_type()
            .is_file()
            .then(|| MediaFormat::for_path(entry.path()))
            .flatten()
        else {
            continue;
        };
        if candidates == MAX_MEDIA {
            report.partial = true;
            break;
        }
        candidates += 1;
        let Some(relative) = entry.path().strip_prefix(&root).ok().and_then(Path::to_str) else {
            report.skipped += 1;
            continue;
        };
        let Ok((path, file)) = checked_file(&root, Path::new(relative)) else {
            report.skipped += 1;
            continue;
        };
        let Some(entry) = index_entry(&path, relative, file, &format, probe, &known) else {
            report.skipped += 1;
            continue;
        };
        if entry.metadata.is_some() {
            report.indexed += 1;
        } else {
            report.reused += 1;
        }
        entries.push(entry);
    }

    check_root(&root)?;
    store.apply_scan(folder_id, &entries, report.partial)?;
    Ok(report)
}

fn index_entry(
    path: &Path,
    relative: &str,
    file: FileMetadata,
    format: &MediaFormat,
    probe: &impl MediaProbe,
    known: &HashMap<String, (i64, String)>,
) -> Option<IndexEntry> {
    if file.len() == 0 || file.len() >= 1 << 53 {
        return None;
    }
    let bytes = file.len() as i64;
    let modified = file
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_nanos().to_string())
        .unwrap_or_default();
    let unchanged = !modified.is_empty()
        && known
            .get(relative)
            .is_some_and(|old| old.0 == bytes && old.1 == modified);
    let metadata = if unchanged {
        None
    } else {
        Some(probe.inspect(path, format)?)
    };
    Some(IndexEntry {
        relative_path: relative.to_owned(),
        bytes,
        modified,
        metadata,
    })
}
