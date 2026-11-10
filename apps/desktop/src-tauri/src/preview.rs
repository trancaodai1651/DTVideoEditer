use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use http_range::HttpRange;
use tauri::http::{Method, Request, Response, StatusCode, header};

use crate::{library::authorized_file, probe::MediaFormat, store::Store};

const MAX_RANGE: u64 = 4 * 1024 * 1024;
const MAX_FULL: u64 = 24 * 1024 * 1024;

pub fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("static response headers")
}

pub fn serve(store: &Store, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin.is_some_and(|value| {
        !matches!(
            value,
            "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
        ) && !(cfg!(dev) && value == "http://127.0.0.1:1420")
    }) {
        return empty(StatusCode::FORBIDDEN);
    }
    let mut response = media_response(store, &request);
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
        response
            .headers_mut()
            .insert(header::VARY, header::HeaderValue::from_static("Origin"));
    }
    response
}

fn media_response(store: &Store, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let head = *request.method() == Method::HEAD;
    if !head && *request.method() != Method::GET {
        return empty(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some((route, id)) = request
        .uri()
        .path()
        .strip_prefix('/')
        .and_then(|path| path.split_once('-'))
    else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(asset_id) = id.parse::<i64>() else {
        return empty(StatusCode::NOT_FOUND);
    };
    let thumbnail = route == "thumbnail";
    if asset_id < 1 || (!thumbnail && !matches!(route, "source" | "render")) {
        return empty(StatusCode::NOT_FOUND);
    }
    if route == "render" {
        let Ok(job) = store.render_job(asset_id) else {
            return empty(StatusCode::NOT_FOUND);
        };
        let output = Path::new(&job.output_path);
        let (Some(parent), Some(name)) = (output.parent(), output.file_name()) else {
            return empty(StatusCode::NOT_FOUND);
        };
        if job.status != "done"
            || !output
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("mp4"))
        {
            return empty(StatusCode::NOT_FOUND);
        }
        let Ok((path, _)) = authorized_file(parent, Path::new(name)) else {
            return empty(StatusCode::NOT_FOUND);
        };
        return file_response(&path, "video/mp4", head, request);
    }
    let Ok(Some(source)) = store.source(asset_id, thumbnail) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok((path, _)) = authorized_file(Path::new(&source.root), Path::new(&source.relative_path))
    else {
        return empty(StatusCode::NOT_FOUND);
    };
    if thumbnail {
        let Some(bytes) = source.thumbnail else {
            return empty(StatusCode::NOT_FOUND);
        };
        return headers("image/jpeg", bytes.len() as u64)
            .body(if head { Vec::new() } else { bytes })
            .expect("static thumbnail headers");
    }

    let Some(format) = MediaFormat::for_path(&path) else {
        return empty(StatusCode::NOT_FOUND);
    };
    file_response(&path, format.mime(&source.kind), head, request)
}

fn file_response(
    path: &Path,
    mime: &'static str,
    head: bool,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Ok(mut file) = File::open(path) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(metadata) = file.metadata() else {
        return empty(StatusCode::NOT_FOUND);
    };
    let size = metadata.len();
    let response = headers(mime, size).header(header::ACCEPT_RANGES, "bytes");
    if head {
        return response.body(Vec::new()).expect("static media headers");
    }

    if let Some(value) = request.headers().get(header::RANGE) {
        let range = value
            .to_str()
            .ok()
            .and_then(|value| single_range(value, size));
        let Some((start, length)) = range else {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .header(header::CACHE_CONTROL, "no-store")
                .body(Vec::new())
                .expect("numeric range header");
        };
        let mut bytes = vec![0; length as usize];
        if file
            .seek(SeekFrom::Start(start))
            .and_then(|_| file.read_exact(&mut bytes))
            .is_err()
        {
            return empty(StatusCode::NOT_FOUND);
        }
        return headers(mime, length)
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{}/{size}", start + length - 1),
            )
            .body(bytes)
            .expect("numeric range header");
    }
    if size > MAX_FULL {
        return empty(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let mut bytes = vec![0; size as usize];
    if file.read_exact(&mut bytes).is_err() {
        return empty(StatusCode::NOT_FOUND);
    }
    response.body(bytes).expect("static media headers")
}

fn headers(mime: &'static str, length: u64) -> tauri::http::response::Builder {
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
}

fn single_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let ranges = HttpRange::parse(value, size).ok()?;
    let [range] = ranges.as_slice() else {
        return None;
    };
    (range.length > 0).then_some((range.start, range.length.min(MAX_RANGE)))
}

#[cfg(test)]
mod tests {
    use super::{MAX_RANGE, single_range};

    #[test]
    fn validates_and_bounds_byte_ranges() {
        assert_eq!(single_range("bytes=10-19", 25), Some((10, 10)));
        assert_eq!(single_range("bytes=-4", 25), Some((21, 4)));
        assert_eq!(
            single_range("bytes=0-", MAX_RANGE + 50),
            Some((0, MAX_RANGE))
        );
        assert_eq!(single_range("bytes=100-", 25), None);
        assert_eq!(single_range("bytes=0-1,5-6", 25), None);
        assert_eq!(single_range("bytes=0-", 0), None);
    }
}
