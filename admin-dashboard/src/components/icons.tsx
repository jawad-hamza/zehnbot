// One icon family for the whole product: Phosphor, regular weight. Nothing is hand-drawn
// (the two logos at the bottom are the brand's own artwork, not icons).
// The app imports from here (never from the library directly) so the family and the weight
// can only be decided in one place.
//
// Icons are decoration beside a text label, so they are hidden from screen readers by default;
// an icon-only button gets its name from the button's own aria-label.
import type { ComponentType } from "react";
import {
  ArrowRight, BookOpenText, ChartBar, ChatCircleDots, Check, Eye, EyeSlash, GearSix, Globe, House,
  Lightning, List, Moon, PlugsConnected, Plus, Question, Robot, ShieldCheck, SignOut, Sparkle,
  Stack, Sun, UserPlus, GoogleLogo, EnvelopeSimple, PaperPlaneTilt, MagicWand, Tray, UsersThree, Warning, X, CaretDown, Code, MagnifyingGlass, FileText, Handshake,
  type IconProps as PhosphorProps,
} from "@phosphor-icons/react";

export type IconProps = Omit<PhosphorProps, "weight"> & { size?: number };

function wrap(Glyph: ComponentType<PhosphorProps>) {
  return function Icon({ size = 18, ...rest }: IconProps) {
    return <Glyph size={size} weight="regular" aria-hidden="true" focusable="false" {...rest} />;
  };
}

export const IconHome = wrap(House);
export const IconBot = wrap(Robot);
export const IconUsers = wrap(UsersThree);
export const IconSettings = wrap(GearSix);
export const IconSun = wrap(Sun);
export const IconMoon = wrap(Moon);
export const IconMenu = wrap(List);
export const IconClose = wrap(X);
export const IconLogout = wrap(SignOut);
export const IconChat = wrap(ChatCircleDots);
export const IconLead = wrap(UserPlus);
export const IconCheck = wrap(Check);
export const IconArrowRight = wrap(ArrowRight);
export const IconSpark = wrap(Sparkle);
export const IconBook = wrap(BookOpenText);
export const IconChart = wrap(ChartBar);
export const IconShield = wrap(ShieldCheck);
export const IconPlug = wrap(PlugsConnected);
export const IconGlobe = wrap(Globe);
export const IconZap = wrap(Lightning);
export const IconEye = wrap(Eye);
export const IconEyeOff = wrap(EyeSlash);
export const IconAlert = wrap(Warning);
export const IconPlus = wrap(Plus);
export const IconHelp = wrap(Question);
export const IconLayers = wrap(Stack);
export const IconCaret = wrap(CaretDown);
export const IconCode = wrap(Code);
export const IconSearch = wrap(MagnifyingGlass);
export const IconFile = wrap(FileText);
export const IconHandshake = wrap(Handshake);
export const IconGoogle = wrap(GoogleLogo);
export const IconMail = wrap(EnvelopeSimple);
export const IconSend = wrap(PaperPlaneTilt);
export const IconWand = wrap(MagicWand);
export const IconInbox = wrap(Tray);

/** The ZehnBot mark: the product's own logo, as an app-icon tile (it carries its own dark ground). */
export function BrandMark({ size = 32 }: { size?: number }) {
  const file = size > 64 ? "/brand/zehnbot-256.webp" : size > 32 ? "/brand/zehnbot-128.webp" : "/brand/zehnbot-64.webp";
  return <img className="zb-brand-mark" src={file} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: Math.round(size * 0.31) }} />;
}

// The Zehnox wordmark. These outlines are the brand sheet's own vectors (extracted from the PDF), not a redrawing.
const ZEHNOX_WORDMARK = "M-0 6.22L28.22 6.22L-0 29.32L-0 34.28L38.2 34.28L38.2 28.71L9.83 28.71L38.2 5.62L38.2 0.65L-0 0.65Z M41.93 6.23L74.99 6.23L74.99 0.65L41.93 0.65Z M48.16 19.93L73.86 19.93L73.86 14.36L41.93 14.36L41.93 34.28L74.99 34.28L74.99 28.71L48.16 28.71Z M111.35 14.35L84.95 14.35L84.95 0.65L78.73 0.65L78.73 34.28L84.95 34.28L84.95 19.93L111.35 19.93L111.35 34.28L117.57 34.28L117.57 0.65L111.35 0.65Z M156.89 25.85L126.96 0.65L121.31 0.65L121.31 34.28L127.53 34.28L127.53 8.88L157.46 34.28L163.11 34.28L163.11 0.65L156.89 0.65Z M201.45 17.87C201.45 20.13 201.37 22.03 201.22 23.5C201.07 24.88 200.8 25.98 200.42 26.77C200.08 27.46 199.62 27.96 198.99 28.3C198.3 28.67 197.35 28.92 196.17 29.04C194.88 29.17 193.27 29.24 191.37 29.24L183.16 29.24C181.26 29.24 179.65 29.17 178.36 29.04C177.18 28.92 176.23 28.67 175.54 28.3C174.91 27.96 174.45 27.46 174.11 26.77C173.73 25.98 173.46 24.88 173.31 23.5C173.16 22.03 173.08 20.14 173.08 17.87L173.08 17.06C173.08 14.71 173.16 12.77 173.32 11.27C173.46 9.86 173.73 8.76 174.11 7.99C174.44 7.32 174.9 6.84 175.5 6.54C176.21 6.19 177.16 5.97 178.34 5.86C179.64 5.75 181.26 5.69 183.16 5.69L191.37 5.69C193.27 5.69 194.89 5.75 196.19 5.86C197.37 5.97 198.32 6.19 199.03 6.54C199.63 6.84 200.09 7.32 200.42 7.99C200.8 8.76 201.07 9.86 201.21 11.27C201.37 12.77 201.45 14.72 201.45 17.06ZM207.68 17.87L207.68 17.06C207.68 14.24 207.54 11.84 207.26 9.91C206.97 7.9 206.45 6.21 205.71 4.91C204.94 3.54 203.88 2.48 202.54 1.75C201.27 1.06 199.67 0.59 197.8 0.35C196.02 0.12 193.86 0 191.37 0L183.16 0C180.67 0 178.51 0.12 176.73 0.35C174.85 0.59 173.26 1.06 171.99 1.75C170.65 2.48 169.59 3.54 168.82 4.91C168.08 6.21 167.56 7.9 167.27 9.91C166.99 11.84 166.85 14.24 166.85 17.06L166.85 17.87C166.85 21.3 167.08 24.13 167.54 26.29C168.03 28.59 168.91 30.41 170.17 31.68C171.44 32.95 173.19 33.83 175.38 34.29C177.42 34.72 180.03 34.93 183.16 34.93L191.37 34.93C194.5 34.93 197.11 34.72 199.16 34.29C201.34 33.83 203.09 32.95 204.35 31.68C205.62 30.41 206.5 28.59 206.99 26.29C207.45 24.13 207.68 21.3 207.68 17.87 M234 16.6L251.17 0.65L242.23 0.65L229.44 12.52L216.23 0.65L207.23 0.65L225.03 16.62L206 34.28L214.94 34.28L229.57 20.7L244.71 34.28L253.71 34.28Z";

/** "by Zehnox" attribution. Takes the colour of the text around it, so it works on any ground. */
export function ZehnoxWordmark({ height = 12 }: { height?: number }) {
  return (
    <svg viewBox="0 0 253.71 34.93" style={{ height, width: "auto" }} role="img" aria-label="Zehnox" fill="currentColor">
      <path d={ZEHNOX_WORDMARK} />
    </svg>
  );
}
