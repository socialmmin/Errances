
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { I18nProvider } from '@/components/I18nProvider';
import { Layout } from '@/components/layout/Layout';
import { AnalyticsTracker } from '@/components/AnalyticsTracker';
import { Toaster } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { TourList } from '@/pages/tours/TourList';
import { TourDetails } from '@/pages/tours/TourDetails';
import { TourForm } from '@/pages/tours/TourForm';
import { WhatsApp } from '@/pages/whatsapp/WhatsApp';
import { Templates } from '@/pages/whatsapp/Templates';
import { AutomationFlow } from '@/pages/automation/AutomationFlow';
import { Leads } from '@/pages/leads/Leads';
import { Contacts } from '@/pages/contacts/Contacts';
import { LeadDetails } from '@/pages/leads/LeadDetails';
import { Pipeline } from '@/pages/pipeline/Pipeline';
import { Analytics } from '@/pages/analytics/Analytics';
import { Staff } from '@/pages/staff/Staff';
import { StaffDetails } from '@/pages/staff/StaffDetails';
import { TravelConsultants } from '@/pages/staff/TravelConsultants';
import { WhatsAppSettings } from '@/pages/admin/WhatsAppSettings';
import { Settings } from '@/pages/settings/Settings';

// ... inside Routes
// This comment seems to be a remnant from the original context, removing it as it's not relevant to the final code structure.

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="leads" element={<Leads />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="leads/:id" element={<LeadDetails />} />
        <Route path="tours" element={<TourList />} />
        <Route path="tours/new" element={<TourForm />} />
        <Route path="tours/:id" element={<TourDetails />} />
        <Route path="tours/:id/edit" element={<TourForm />} />
        <Route path="whatsapp" element={<WhatsApp />} />
        <Route path="whatsapp/templates" element={<Templates />} />
        <Route path="automation" element={<AutomationFlow />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="consultants" element={<TravelConsultants />} />
        <Route path="staff" element={
          user?.role === 'admin' ? <Staff /> : <Navigate to="/" replace />
        } />
        <Route path="staff/:id" element={
          user?.role === 'admin' ? <StaffDetails /> : <Navigate to="/" replace />
        } />
        <Route path="settings" element={
          (user?.role === 'admin' || user?.role === 'sales_manager') ? <Settings /> : <Navigate to="/" replace />
        } />
        <Route path="settings/whatsapp" element={
          (user?.role === 'admin' || user?.role === 'sales_manager') ? <WhatsAppSettings /> : <Navigate to="/" replace />
        } />
        <Route path="*" element={<div className="py-20 text-center space-y-4"><h1 className="text-2xl font-semibold">Page not found</h1><Link className="text-teal-700 underline" to="/">Return to dashboard</Link></div>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Router>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>
            <AnalyticsTracker />
            <Toaster />
            <AppRoutes />
          </TooltipProvider>
        </AuthProvider>
      </Router>
    </I18nProvider>
  );
}

