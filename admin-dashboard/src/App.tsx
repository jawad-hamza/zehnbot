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
import OverviewPage from "./pages/OverviewPage";
import HomeRoute from "./pages/HomeRoute";
import EnquiriesPage from "./pages/EnquiriesPage";
import { AuthCallbackPage, VerifyEmailPage } from "./pages/AuthLandingPages";


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="overview" element={<OverviewPage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="enquiries" element={<EnquiriesPage />} />
          <Route path="bots" element={<ClientsPage />} />
          <Route path="bots/new" element={<ClientEditPage />} />
          <Route path="bots/:id/edit" element={<ClientEditPage />} />
          <Route path="bots/:id/knowledge" element={<KnowledgePage />} />
          <Route path="bots/:id/conversations" element={<ConversationsPage />} />
          <Route path="bots/:id/leads" element={<LeadsPage />} />
          <Route path="bots/:id/test" element={<TestChatPage />} />
          <Route path="bots/:id/insights" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* bookmarks from before the rename keep working */}
          <Route path="clients/*" element={<Navigate to="/bots" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
