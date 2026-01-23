/**
 * Componente principal de la aplicación con Router
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
import ConfiguracionSistema from '@/pages/Configuracion/ConfiguracionSistema';

/**
 * Componente para rutas protegidas
 */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/**
 * Componente principal
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta pública - Login */}
        <Route path="/login" element={<Login />} />

        {/* Rutas protegidas */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          {/* Dashboard */}
          <Route index element={<Dashboard />} />

          {/* Sincronización SAP */}
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

          {/* Configuración */}
          <Route path="configuracion" element={<ConfiguracionSistema />} />
        </Route>

        {/* Ruta 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
