import { Navigate } from "react-router-dom";
import { loginPathFor, useAuthStore } from "../store/authStore";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const kind = useAuthStore((s) => s.kind);
  return token ? <>{children}</> : <Navigate to={loginPathFor(kind)} replace />;
}
