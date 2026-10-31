import { Link, Outlet, useLocation } from "react-router-dom";
import { FileText, LayoutDashboard, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function Layout() {
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);

  // Busca quantas CNDs estão na fila de geração (pendentes ou processando)
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const { count } = await supabase
          .from("lote_itens")
          .select("*", { count: "exact", head: true })
          .in("status", ["pendente", "processando"]);
        
        setPendingCount(count || 0);
      } catch (err) {
        console.error("Erro ao buscar CNDs pendentes:", err);
      }
    };

    fetchPending();
    const interval = setInterval(fetchPending, 3000); // Atualiza a cada 3s
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { name: "Painel", path: "/", icon: <LayoutDashboard size={18} /> },
    { name: "Certidões", path: "/certidoes", icon: <FileText size={18} /> },
    { name: "Configurações", path: "/configuracoes", icon: <Settings size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Topbar */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary rounded flex items-center justify-center font-bold text-white">
              C
            </div>
            <span className="text-lg font-bold">CNDs Automatic</span>
          </div>

          <nav className="flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === item.path
                    ? "bg-secondary text-primary"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                {/* Badge de Notificação no menu Certidões */}
                {item.name === "Certidões" && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-card animate-in zoom-in duration-300">
                    {pendingCount}
                  </span>
                )}
                
                {item.icon}
                <span>{item.name}</span>
              </Link>
            ))}
          </nav>
          
          <div className="text-sm text-muted-foreground">
            Integrados Soluções
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
