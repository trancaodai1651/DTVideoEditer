import { useEffect, useState } from "react";
import { api, desktop } from "./desktop";

export function AvatarPanel({ busy, onCreate, onGet }: {
  busy: boolean;
  onCreate: (avatar: string, voice: string, script: string) => Promise<string | null>;
  onGet: (id: string) => void;
}) {
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [avatar, setAvatar] = useState("");
  const [voice, setVoice] = useState("");
  const [script, setScript] = useState("");
  const [id, setId] = useState(() => {
    try { return localStorage.getItem("dt-edit-heygen-job") ?? ""; } catch { return ""; }
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    if (desktop) void api.avatarKeyStatus().then((value) => { if (active) setHasKey(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return <details className="tool-detail avatar-tools">
    <summary>Video avatar AI · HeyGen</summary>
    <p>Dùng một avatar có sẵn trên tài khoản HeyGen. Video hoàn tất được đưa vào thư viện.</p>
    <form onSubmit={(event) => {
      event.preventDefault(); setSaving(true); setError("");
      void api.setAvatarKey(key).then(() => { setHasKey(true); setKey(""); })
        .catch((reason: unknown) => setError(String(reason))).finally(() => setSaving(false));
    }}>
      <label className="edit-field">API key HeyGen<input type="password" autoComplete="off" minLength={12} maxLength={512} value={key}
        placeholder={hasKey ? "Đã lưu trong keychain" : "Nhập API key của bạn"} onChange={(event) => setKey(event.target.value)} /></label>
      <button type="submit" className="button secondary compact" disabled={busy || saving || key.trim().length < 12}>Lưu key</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      void onCreate(avatar, voice, script).then((result) => {
        if (!result) return;
        setId(result);
        try { localStorage.setItem("dt-edit-heygen-job", result); } catch { /* optional */ }
      });
    }}>
      <label className="edit-field">Avatar Look ID<input required maxLength={128} value={avatar} onChange={(event) => setAvatar(event.target.value)} /></label>
      <label className="edit-field">Voice ID<input required maxLength={128} value={voice} onChange={(event) => setVoice(event.target.value)} /></label>
      <label className="edit-field">Lời thoại<textarea required maxLength={2000} value={script} onChange={(event) => setScript(event.target.value)} /></label>
      <button type="submit" className="button primary" disabled={busy || !hasKey || !avatar.trim() || !voice.trim() || !script.trim()}>Tạo video avatar</button>
    </form>
    <form onSubmit={(event) => { event.preventDefault(); onGet(id.trim()); }}>
      <label className="edit-field">Mã video<input required maxLength={128} value={id} onChange={(event) => setId(event.target.value)} /></label>
      <button type="submit" className="button secondary" disabled={busy || !hasKey || !id.trim()}>Kiểm tra và nhập video</button>
    </form>
  </details>;
}
