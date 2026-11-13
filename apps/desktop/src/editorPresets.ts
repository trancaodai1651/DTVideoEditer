import type { CaptionMotion, ClipLook, TitleStyle, TransitionKind } from "./desktop";

export type CaptionPreset = Pick<TitleStyle, "captionMotion" | "font" | "color" | "colorHex" | "highlightHex" |
  "strokeHex" | "strokeWidth" | "size" | "background" | "backgroundHex" | "backgroundOpacity" | "shadow">;

export const captionPresets = [
  { id: "karaoke", name: "Karaoke vàng", group: "Theo lời", style: { captionMotion: "highlight", font: "bold", color: "white", highlightHex: "#ffe34d", strokeWidth: 3, size: 6, background: false } },
  { id: "mint", name: "Nhịp bạc hà", group: "Theo lời", style: { captionMotion: "highlight", font: "bold", color: "white", highlightHex: "#7dfab7", strokeWidth: 3, size: 6, background: false } },
  { id: "coral", name: "Nhịp san hô", group: "Theo lời", style: { captionMotion: "highlight", font: "sans", color: "white", highlightHex: "#ff8b83", strokeWidth: 3, size: 6, background: false } },
  { id: "cream", name: "Lời kể", group: "Theo lời", style: { captionMotion: "highlight", font: "serif", color: "white", colorHex: "#fff1d6", highlightHex: "#f6bd69", strokeWidth: 2, size: 6, background: false } },
  { id: "sky", name: "Hiện chữ xanh", group: "Hiện dần", style: { captionMotion: "reveal", font: "bold", color: "white", highlightHex: "#82daff", strokeWidth: 3, size: 6, background: false } },
  { id: "peach", name: "Hiện chữ cam", group: "Hiện dần", style: { captionMotion: "reveal", font: "bold", color: "white", highlightHex: "#ffba85", strokeWidth: 3, size: 7, background: false } },
  { id: "violet", name: "Hiện chữ tím", group: "Hiện dần", style: { captionMotion: "reveal", font: "mono", color: "white", highlightHex: "#d6b2ff", strokeWidth: 3, size: 6, background: false } },
  { id: "plain", name: "Trắng cổ điển", group: "Tĩnh", style: { captionMotion: "static", font: "sans", color: "white", strokeWidth: 2, size: 5, background: true, backgroundOpacity: 66 } },
  { id: "cream-static", name: "Phim tài liệu", group: "Tĩnh", style: { captionMotion: "static", font: "serif", color: "white", colorHex: "#ffefce", strokeWidth: 2, size: 5, background: false, shadow: true } },
  { id: "navy", name: "Nhãn xanh đậm", group: "Tĩnh", style: { captionMotion: "static", font: "bold", color: "white", strokeWidth: 1, size: 5, background: true, backgroundHex: "#172d4d", backgroundOpacity: 90 } },
] satisfies { id: string; name: string; group: string; style: CaptionPreset & { captionMotion: CaptionMotion } }[];

export function applyCaptionPreset(title: TitleStyle, preset: CaptionPreset): TitleStyle {
  return {
    ...title, colorHex: undefined, highlightHex: undefined, strokeHex: undefined,
    backgroundHex: undefined, backgroundOpacity: undefined, shadow: undefined, ...preset,
  };
}

export const transitions = {
  dissolve: { name: "Hòa trộn", group: "Mờ", swatch: "#44658c" },
  black: { name: "Qua đen", group: "Mờ", swatch: "#272834" },
  white: { name: "Qua trắng", group: "Mờ", swatch: "#bac6d0" },
  slide_left: { name: "Vuốt sang trái", group: "Trượt", swatch: "#286c68" },
  slide_right: { name: "Vuốt sang phải", group: "Trượt", swatch: "#79549d" },
  slide_up: { name: "Vuốt lên", group: "Trượt", swatch: "#9a5f48" },
} satisfies Record<TransitionKind, { name: string; group: string; swatch: string }>;

export const extraFilters = [
  { label: "Phim bạc", detail: "Tông lạnh, đen sâu", swatch: "#6d8296", look: { brightness: -3, contrast: 125, saturation: 50, temperature: -24 } },
  { label: "Nắng nhẹ", detail: "Màu ấm sáng cho cảnh ngoài trời", swatch: "#cb9156", look: { brightness: 5, contrast: 105, saturation: 112, temperature: 28 } },
  { label: "Hoàng hôn", detail: "Tông cam tím, tương phản dịu", swatch: "#a05868", look: { brightness: -3, contrast: 96, saturation: 122, temperature: 40, tint: 22 } },
  { label: "Sương sớm", detail: "Vùng tối nâng nhẹ, màu dịu", swatch: "#8d9b92", look: { brightness: 6, contrast: 86, saturation: 72, temperature: -12, shadows: 22 } },
  { label: "Phố đêm", detail: "Xanh lạnh và vùng sáng rõ", swatch: "#385c77", look: { brightness: -9, contrast: 122, saturation: 92, temperature: -44, highlights: 18 } },
  { label: "Giấy nâu", detail: "Màu hoài cổ và giảm bão hòa", swatch: "#9c7355", look: { brightness: 3, contrast: 96, saturation: 49, temperature: 53 } },
  { label: "Biển xanh", detail: "Màu xanh mát và trong", swatch: "#4c8798", look: { brightness: 4, contrast: 112, saturation: 128, temperature: -27, tint: -12 } },
  { label: "Chân dung mềm", detail: "Giảm tương phản và vùng sáng gắt", swatch: "#c48f88", look: { brightness: 4, contrast: 88, saturation: 93, temperature: 17, highlights: -25 } },
  { label: "Đen trắng đậm", detail: "Đen trắng với tương phản mạnh", swatch: "#505057", look: { brightness: 0, contrast: 143, saturation: 0, temperature: 0, blacks: -18 } },
] satisfies { label: string; detail: string; swatch: string; look: Partial<ClipLook> }[];
