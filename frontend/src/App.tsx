import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { Layout, RequireAdmin, RequireAuth, RequireTeam } from "./components/Layout";
import { LightboxProvider } from "./components/Lightbox";
import { ActivityPage } from "./pages/ActivityPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import {
  NewSectionPage,
  NewTaskPage,
  SectionEditPage,
  SectionHistoryPage,
  TaskEditPage,
  TaskHistoryPage,
  TaskPage,
} from "./pages/EditPages";
import { HomePage } from "./pages/HomePage";
import { AccountPage, NotFoundPage, SearchPage } from "./pages/MiscPages";
import { SectionPage } from "./pages/SectionPage";
import { TasksPage } from "./pages/TasksPage";
import { UsersPage } from "./pages/UsersPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="s/:slug" element={<SectionPage />} />
        <Route path="s/:slug/history" element={<SectionHistoryPage />} />
        <Route path="s/:slug/edit" element={<RequireTeam><SectionEditPage /></RequireTeam>} />
        <Route path="t/:code" element={<TaskPage />} />
        <Route path="t/:code/history" element={<TaskHistoryPage />} />
        <Route path="t/:code/edit" element={<RequireTeam><TaskEditPage /></RequireTeam>} />
        <Route path="new/section" element={<RequireTeam><NewSectionPage /></RequireTeam>} />
        <Route path="new/task" element={<RequireTeam><NewTaskPage /></RequireTeam>} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LightboxProvider>
        <AppRoutes />
      </LightboxProvider>
    </AuthProvider>
  );
}
