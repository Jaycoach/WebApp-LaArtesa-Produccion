/**
 * App.tsx — ARTESA
 * Actualizado 2026-03-02: agrega rutas formado, fermentacion, horneado, empaque
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store';

// Layouts
import MainLayout from '@/components/layout/MainLayout';

// Pages
import Login from '@/pages/Login/Login';
import Dashboard from '@/pages/Dashboard/Dashboard';
import SincronizarSAP from '@/pages/Sincronizacion/SincronizarSAP';
import ListaMasas from '@/pages/Planificacion/ListaMasas';
import DetalleMasa from '@/pages/Planificacion/DetalleMasa';
import PlanificacionProduccion from '@/pages/Planificacion/PlanificacionProduccion';
import PesajeMasa from '@/pages/Pesaje/PesajeMasa';
import ConfirmarPesaje from '@/pages/Pesaje/ConfirmarPesaje';
import AmasadoMasa from '@/pages/Amasado/AmasadoMasa';
import DivisionMasa from '@/pages/Division/DivisionMasa';
import FormadoMasa from '@/pages/Formado/FormadoMasa';
import FermentacionMasa from '@/pages/Fermentacion/FermentacionMasa';
import HorneadoMasa from '@/pages/Horneado/HorneadoMasa';
import EmpaqueMasa from '@/pages/Empaque/EmpaqueMasa';
import ReporteCostos from '@/pages/Reportes/ReporteCostos';
import ConfiguracionSistema from '@/pages/Configuracion/ConfiguracionSistema';
import CostosConfig from '@/pages/Configuracion/CostosConfig';
import GestionUsuarios from '@/pages/Configuracion/GestionUsuarios';
import ForgotPassword from '@/pages/Auth/ForgotPassword';
import ResetPassword from '@/pages/Auth/ResetPassword';
import VerifyEmail from '@/pages/Auth/VerifyEmail';
import FaseListado from '@/pages/Fases/FaseListado';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="sincronizar" element={<SincronizarSAP />} />

          {/* Planificación */}
          <Route path="planificacion">
            <Route index element={<ListaMasas />} />
            <Route path="masas" element={<ListaMasas />} />
            <Route path="masas/:id" element={<DetalleMasa />} />
            <Route path="produccion" element={<PlanificacionProduccion />} />
          </Route>

          {/* Pesaje */}
          <Route path="pesaje">
            <Route path=":masaId" element={<PesajeMasa />} />
            <Route path=":masaId/confirmar" element={<ConfirmarPesaje />} />
          </Route>

          {/* Amasado */}
          <Route path="amasado">
            <Route path=":masaId" element={<AmasadoMasa />} />
          </Route>

          {/* División */}
          <Route path="division">
            <Route path=":masaId" element={<DivisionMasa />} />
          </Route>

          {/* Formado */}
          <Route path="formado">
            <Route path=":masaId" element={<FormadoMasa />} />
          </Route>

          {/* Fermentación */}
          <Route path="fermentacion">
            <Route path=":masaId" element={<FermentacionMasa />} />
          </Route>

          {/* Horneado */}
          <Route path="horneado">
            <Route path=":masaId" element={<HorneadoMasa />} />
          </Route>

          {/* Empaque — búsqueda por OV, sin masaId en URL */}
          <Route path="empaque">
            <Route index element={<EmpaqueMasa />} />
            <Route path=":masaId" element={<EmpaqueMasa />} />
          </Route>

          {/* Reportes */}
          <Route path="reportes">
            <Route path="costos" element={<ReporteCostos />} />
          </Route>

          {/* Fases de producción - listado por fase */}
          <Route path="fase/:nombreFase" element={<FaseListado />} />

          {/* Configuración */}
          <Route path="configuracion" element={<ConfiguracionSistema />} />
          <Route path="configuracion/costos" element={<CostosConfig />} />
          <Route path="configuracion/usuarios" element={<GestionUsuarios />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
