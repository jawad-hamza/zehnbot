import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ClientsPage from "./pages/ClientsPage";
import ClientEditPage from "./pages/ClientEditPage";
import KnowledgePage from "./pages/KnowledgePage";
import ConversationsPage from "./pages/ConversationsPage";
import LeadsPage from "./pages/LeadsPage";
import SettingsPage from "./pages/SettingsPage";
import TestChatPage from "./pages/TestChatPage";
import TenantsPage from "./pages/TenantsPage";
import AnalyticsPage from "./pages/AnalyticsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/clients" replace />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/new" element={<ClientEditPage />} />
          <Route path="clients/:id/edit" element={<ClientEditPage />} />
          <Route path="clients/:id/knowledge" element={<KnowledgePage />} />
          <Route path="clients/:id/conversations" element={<ConversationsPage />} />
          <Route path="clients/:id/leads" element={<LeadsPage />} />
          <Route path="clients/:id/test" element={<TestChatPage />} />
          <Route path="clients/:id/insights" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
