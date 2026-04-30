import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const JIRA_DOMAIN = process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

async function checkFields() {
  const url = `${JIRA_DOMAIN}/rest/api/2/field`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${JIRA_API_TOKEN}`,
      "Accept": "application/json"
    }
  });
  const fields = await res.json();
  const startFields = fields.filter(f => f.name.toLowerCase().includes('start') || f.name.toLowerCase().includes('시작'));
  console.log("Start Date Fields:", startFields.map(f => ({ id: f.id, name: f.name })));
}

checkFields();
