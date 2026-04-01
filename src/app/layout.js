import "./globals.css";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";

export const metadata = {
  title: "Jira Dashboard",
  description: "Confluence 스타일의 Jira 업무 관리 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <div className="app-container">
          <Sidebar />
          <div className="main-wrapper">
            <Header />
            <main className="content-area">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
