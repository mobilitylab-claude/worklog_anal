"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();
  
  const navItems = [
    { name: "대시보드", path: "/", icon: "📊" },
    { name: "Filter Generation", path: "/filter-generation", icon: "📋" },
    { name: "저장된 필터 관리", path: "/filter-management", icon: "📑" },
    { name: "워크로그 분석기", path: "/worklog", icon: "⏱️" },
    { name: "JIRA 사용자 관리", path: "/user-management", icon: "👥" },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-icon">🚀</span>
        <span className="logo-text">Jira Workspace</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link 
            href={item.path} 
            key={item.name} 
            className={`nav-item ${pathname === item.path ? "active" : ""}`}
            onClick={(e) => {
               if(item.path === "#") e.preventDefault();
            }}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-text">{item.name}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
