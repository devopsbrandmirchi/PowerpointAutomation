import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Pages/login';
import Dashbaord, { ReportGeneratorView } from './Pages/Dashbaord';
import Drive from './Pages/Drive';
import AutomationLogs from './Pages/AutomationLogs';
import ConfigDealer from './Pages/config_dealer';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './Components/RequireAuth';

/**
 * Routing: home and unknown paths go to `/login` first. `/dashboard/*` is behind `RequireAuth` (Supabase session).
 * Idle timeout after login: `middleware/SessionGuard.jsx` inside the dashboard shell. See `docs/DEPLOYMENT.md`.
 */
const App = () => {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashbaord />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="report-generator" replace />} />
            <Route path="report-generator" element={<ReportGeneratorView />} />
            <Route path="drive" element={<Drive />} />
            <Route path="clients" element={<Navigate to="/dashboard/report-generator" replace />} />
            <Route path="logs" element={<AutomationLogs />} />
            <Route path="config-dealer" element={<ConfigDealer />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
};

export default App;
