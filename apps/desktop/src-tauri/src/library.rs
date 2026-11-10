use std::{
    fs::{self, Metadata as FileMetadata},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use walkdir::{DirEntry, WalkDir};

use crate::{
    model::{Result, ScanReport, StudioError},
    probe::{MediaFormat, MediaProbe},
    store::{IndexEntry, Store},
};

const MAX_MEDIA: usize = 600;
const MAX_ENTRIES: usize = 10_000;
const MAX_DEPTH: usize = 12;

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
    let root = PathBuf::from(store.root(folder_id)?);
    check_root(&root)?;
    let known = store.fingerprints(folder_id, probe.generates_thumbnails())?;
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
        if file.len() == 0 || file.len() >= 1 << 53 {
            report.skipped += 1;
            continue;
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
            report.reused += 1;
            None
        } else {
            let Some(metadata) = probe.inspect(&path, &format) else {
                report.skipped += 1;
                continue;
            };
            report.indexed += 1;
            Some(metadata)
        };
        entries.push(IndexEntry {
            relative_path: relative.to_owned(),
            bytes,
            modified,
            metadata,
        });
    }

    check_root(&root)?;
    store.apply_scan(folder_id, &entries, report.partial)?;
    Ok(report)
}
