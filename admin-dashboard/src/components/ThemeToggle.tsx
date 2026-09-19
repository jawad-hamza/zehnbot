import { useTheme } from "../theme";
import { IconMoon, IconSun } from "./icons";

export default function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="zb-icon-btn" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
