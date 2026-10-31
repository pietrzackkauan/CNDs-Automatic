import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Certidoes } from "./pages/Certidoes";

function Configuracoes() {
  return (
    <div className="p-8 text-center text-muted-foreground animate-in fade-in">
      Em breve: Tela de configurações de prioridades e municípios.
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Vai direto para a parte funcional */}
          <Route path="/" element={<Dashboard />} />
          
          <Route path="/certidoes" element={<Certidoes />} />
          
          <Route path="/configuracoes" element={<Configuracoes />} />
          
          {/* Redireciona qualquer rota perdida para o painel principal */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
