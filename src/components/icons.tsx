import React from "react";

type P = { size?: number; className?: string };
const S = ({ size = 18, className, children, viewBox = "0 0 24 24" }: P & { children: React.ReactNode; viewBox?: string }) => (
  <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);

export const IconTelegram = ({ size = 18, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M21.9 4.6c.2-1-.8-1.8-1.7-1.4L2.7 9.9c-1 .4-1 1.9.1 2.2l4.5 1.4 1.7 5.3c.3 1 1.6 1.2 2.2.4l2.3-2.9 4.6 3.4c.8.6 2 .2 2.2-.8l1.6-13.3zM8.5 13.1l8.6-6.6c.3-.2.6.2.4.4l-7 7-.3 3-1.7-3.8z" />
  </svg>
);
export const IconDash = (p: P) => <S {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></S>;
export const IconChat = (p: P) => <S {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /><path d="M8.5 10.5h7M8.5 13.5h4.5" /></S>;
export const IconUsers = (p: P) => <S {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7" /><circle cx="16.8" cy="9.2" r="2.4" /><path d="M16.2 14.6c2.2.2 3.8 1.7 4.3 4" /></S>;
export const IconGear = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" /></S>;
export const IconSend = (p: P) => <S {...p}><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4 18-7z" /></S>;
export const IconSmile = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8" /><path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" /></S>;
export const IconClip = (p: P) => <S {...p}><path d="M20.5 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10.5 17a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></S>;
export const IconSticker = (p: P) => <S {...p}><path d="M12 3a9 9 0 1 0 9 9h-5a4 4 0 0 1-4-4V3z" /><path d="M12 3v5a4 4 0 0 0 4 4h5" /></S>;
export const IconSearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.4-4.4" /></S>;
export const IconPin = (p: P) => <S {...p}><path d="M12 17v5" /><path d="M8 3h8l-1 7 3 3H6l3-3-1-7z" /></S>;
export const IconStar = (p: P) => <S {...p}><path d="M12 3l2.7 5.6 6.3.8-4.6 4.3 1.2 6.1L12 16.9 6.4 19.8l1.2-6.1L3 9.4l6.3-.8L12 3z" /></S>;
export const IconBan = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M5.5 5.5l13 13" /></S>;
export const IconX = (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IconCopy = (p: P) => <S {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></S>;
export const IconInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" strokeWidth="2.2" /></S>;
export const IconReply = (p: P) => <S {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v3" /></S>;
export const IconTrash = (p: P) => <S {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></S>;
export const IconDownload = (p: P) => <S {...p}><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></S>;
export const IconUpload = (p: P) => <S {...p}><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></S>;
export const IconBell = (p: P) => <S {...p}><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></S>;
export const IconMoon = (p: P) => <S {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></S>;
export const IconSun = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>;
export const IconBolt = (p: P) => <S {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></S>;
export const IconLock = (p: P) => <S {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></S>;
export const IconEye = (p: P) => <S {...p}><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></S>;
export const IconBroadcast = (p: P) => <S {...p}><circle cx="12" cy="12" r="2" /><path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9M4.5 4.5a10.5 10.5 0 0 0 0 15M19.5 4.5a10.5 10.5 0 0 1 0 15" /></S>;
export const IconMegaphone = (p: P) => <S {...p}><path d="M3 11v3l4 .8V10.2L3 11z" /><path d="M7 10l12-5v14L7 14v-4z" /><path d="M10 15.5V18a2 2 0 0 0 4 0v-1" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="M4 12.5l5 5L20 6.5" /></S>;
export const IconWifi = (p: P) => <S {...p}><path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0M11 18.5a2 2 0 0 1 2 0" /><path d="M12 19h.01" strokeWidth="2.6" /></S>;
export const IconDoc = (p: P) => <S {...p}><path d="M6 2h8l4 4v16H6V2z" /><path d="M14 2v4h4M9 12h6M9 16h6" /></S>;
export const IconMapPin = (p: P) => <S {...p}><path d="M12 21s-7-6.5-7-11.5a7 7 0 1 1 14 0C19 14.5 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></S>;
export const IconPoll = (p: P) => <S {...p}><path d="M5 20V10M12 20V4M19 20v-7" strokeWidth="2.4" /></S>;
export const IconMic = (p: P) => <S {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></S>;
export const IconPlay = (p: P) => <S {...p}><path d="M7 4l13 8-13 8V4z" /></S>;
export const IconRefresh = (p: P) => <S {...p}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v4h-4" /></S>;
export const IconMenu = (p: P) => <S {...p}><path d="M4 6h16M4 12h16M4 18h16" /></S>;
export const IconLogout = (p: P) => <S {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></S>;
export const IconArchiveBox = (p: P) => <S {...p}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></S>;
export const IconChevronLeft = (p: P) => <S {...p}><path d="M14.5 5l-7 7 7 7" /></S>;
export const IconBot = (p: P) => <S {...p}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V5m0 0a1.5 1.5 0 1 0-.01 0zM9 13h.01M15 13h.01" strokeWidth="2.2" /><path d="M2 13v3M22 13v3" /></S>;
