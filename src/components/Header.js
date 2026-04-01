"use client";

export default function Header() {
  return (
    <header className="header">
      <div className="header-search">
        <input type="text" placeholder="Jira 검색 (추후 연동)..." />
      </div>
      <div className="header-user">
        <div className="avatar">ME</div>
      </div>
    </header>
  );
}
