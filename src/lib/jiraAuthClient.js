export function getJiraAuthHeaders() {
  if (typeof window === "undefined") return {};
  const activeId = localStorage.getItem("jiraActiveId");
  if (!activeId) return {};
  try {
    const accounts = JSON.parse(localStorage.getItem("jiraAccounts") || "[]");
    const active = accounts.find(a => a.id === activeId);
    if (active && active.token) {
      return { "x-jira-token": active.token };
    }
  } catch (e) {}
  return {};
}
