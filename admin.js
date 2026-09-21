/* =========================================================================
   WONDERKINE — PAGE D'ADMINISTRATION (version Supabase)
   -------------------------------------------------------------------------
   Accès réservé : administrateurs (promus automatiquement après 10 articles
   + 5 documents publiés sur au moins 3 thèmes différents) et le créateur du
   site (CREATOR_EMAIL, défini aussi dans script.js — garde les deux valeurs
   identiques).
   ========================================================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "uploads";

const CREATOR_EMAIL = "kine33zwonder@gmail.com"; // doit correspondre à script.js

let viewerIsCreator = false;

supabase.auth.onAuthStateChange((event, session) => {
    checkAccess(session);
});

async function checkAccess(session) {
    const loading = document.getElementById('admin-loading');
    const denied = document.getElementById('access-denied');
    const dashboard = document.getElementById('admin-dashboard');

    if (!session || !session.user) {
        loading.style.display = 'none';
        denied.style.display = 'block';
        dashboard.style.display = 'none';
        return;
    }

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    const isAdmin = (profile && profile.role === 'admin') || session.user.email === CREATOR_EMAIL;
    viewerIsCreator = session.user.email === CREATOR_EMAIL;

    loading.style.display = 'none';
    if (!isAdmin) {
        denied.style.display = 'block';
        dashboard.style.display = 'none';
        return;
    }

    denied.style.display = 'none';
    dashboard.style.display = 'block';
    loadDashboard();
}

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    checkAccess(session);
});

async function loadDashboard() {
    const [{ data: users }, { data: articles }, { data: documents }, { data: reports }] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('articles').select('*'),
        supabase.from('documents').select('*'),
        supabase.from('reports').select('*').order('created_at', { ascending: false })
    ]);

    renderStats(users || [], articles || [], documents || []);
    renderReports(reports || [], articles || [], documents || []);
    renderUsers(users || []);
    renderContent(articles || [], documents || []);
}

function renderStats(users, articles, documents) {
    const totalViews = [...articles, ...documents].reduce((sum, i) => sum + (i.views || 0), 0);
    const totalDownloads = documents.reduce((sum, d) => sum + (d.downloads || 0), 0);

    const stats = [
        { num: users.length, label: 'Inscrits' },
        { num: articles.length, label: 'Articles' },
        { num: documents.length, label: 'Documents' },
        { num: totalViews, label: 'Lectures cumulées' },
        { num: totalDownloads, label: 'Téléchargements' }
    ];

    document.getElementById('stats-row').innerHTML = stats.map(s => `
        <div class="stat-card">
            <div class="num">${s.num}</div>
            <div class="label">${s.label}</div>
        </div>
    `).join('');
}

function renderReports(reports, articles, documents) {
    const container = document.getElementById('reports-list');
    if (reports.length === 0) {
        container.innerHTML = '<p class="empty-note">Aucun signalement en attente.</p>';
        return;
    }

    container.innerHTML = reports.map(r => {
        const source = r.item_type === 'article' ? articles : documents;
        const item = source.find(i => i.id === r.item_id);
        const itemTitle = item ? item.title : '(contenu déjà supprimé)';
        return `
            <div style="border-bottom: 1px solid rgba(15,118,110,0.12); padding: 0.8rem 0; display:flex; justify-content:space-between; align-items:center; gap: 1rem; flex-wrap: wrap;">
                <div>
                    <strong>${itemTitle}</strong> <span style="color:var(--text-light); font-size:0.8rem;">(${r.item_type})</span><br>
                    <span style="font-size:0.85rem; color:var(--text-dark);">Motif : ${r.reason || 'non précisé'}</span><br>
                    <span style="font-size:0.78rem; color:var(--text-light);">Signalé par ${r.reporter_name || 'inconnu'}</span>
                </div>
                <div style="display:flex; gap:0.5rem;">
                    ${item ? `<button class="mini-btn" style="background:#dc2626; color:white;" onclick="window.__adminDeleteReportedContent('${r.id}','${r.item_id}','${r.item_type}')">Supprimer le contenu</button>` : ''}
                    <button class="mini-btn" style="background:rgba(100,116,139,0.15); color:var(--text-dark);" onclick="window.__adminDismissReport('${r.id}')">Ignorer</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>${u.username || '—'}${u.email === CREATOR_EMAIL ? ' 👑' : ''}</td>
            <td style="font-size:0.8rem; color:var(--text-light);">${u.email || '—'}</td>
            <td><span class="role-pill ${u.role === 'admin' ? 'role-admin' : 'role-membre'}">${u.role || 'membre'}</span></td>
            <td>${u.articles_count || 0}</td>
            <td>${u.documents_count || 0}</td>
            <td>${(u.categories_covered || []).length}</td>
            <td>
                ${viewerIsCreator && u.email !== CREATOR_EMAIL ? (
                    u.role === 'admin'
                        ? `<button class="mini-btn" style="background:rgba(100,116,139,0.15); color:var(--text-dark);" onclick="window.__adminSetRole('${u.id}','membre')">Rétrograder</button>`
                        : `<button class="mini-btn" style="background:rgba(15,118,110,0.15); color:var(--primary);" onclick="window.__adminSetRole('${u.id}','admin')">Promouvoir admin</button>`
                ) : ''}
            </td>
        </tr>
    `).join('');
}

function renderContent(articles, documents) {
    const tbody = document.getElementById('content-table-body');
    const all = [
        ...articles.map(a => ({ ...a, kind: 'Article', type: 'article' })),
        ...documents.map(d => ({ ...d, kind: 'Document', type: 'document' }))
    ];

    if (all.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Aucun contenu publié.</td></tr>';
        return;
    }

    tbody.innerHTML = all.map(item => `
        <tr>
            <td>${item.title}</td>
            <td>${item.kind}</td>
            <td>${item.category}</td>
            <td>${item.author_name || '—'}</td>
            <td>${item.views || 0}</td>
            <td><button class="mini-btn" style="background:#dc2626; color:white;" onclick="window.__adminDeleteContent('${item.id}','${item.type}')">Supprimer</button></td>
        </tr>
    `).join('');
}

/* ============================== ACTIONS ADMIN ============================== */

window.__adminSetRole = async function (userId, role) {
    if (!viewerIsCreator) return;
    // admin_set_role est une fonction serveur (SECURITY DEFINER) qui vérifie
    // elle-même que l'appelant est bien admin avant d'appliquer le changement.
    const { error } = await supabase.rpc('admin_set_role', { p_target_id: userId, p_new_role: role });
    if (error) alert("Action refusée : " + error.message);
    loadDashboard();
};

window.__adminDismissReport = async function (reportId) {
    await supabase.from('reports').delete().eq('id', reportId);
    loadDashboard();
};

window.__adminDeleteContent = async function (itemId, type) {
    if (!confirm("Supprimer définitivement ce contenu ?")) return;
    const table = type === 'article' ? 'articles' : 'documents';
    const { error } = await supabase.from(table).delete().eq('id', itemId);
    if (error) alert("La suppression a échoué.");
    loadDashboard();
};

window.__adminDeleteReportedContent = async function (reportId, itemId, itemType) {
    await window.__adminDeleteContent(itemId, itemType);
    await supabase.from('reports').delete().eq('id', reportId);
    loadDashboard();
};
