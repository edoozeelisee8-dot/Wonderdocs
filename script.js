/* =========================================================================
   WONDERKINE — MOTEUR DU SITE (version Supabase)
   -------------------------------------------------------------------------
   Ce fichier connecte le site à Supabase : comptes, articles, documents et
   fichiers sont stockés sur un vrai serveur partagé (base de données
   Postgres), sans qu'aucune carte bancaire ne soit nécessaire pour rester
   dans le plan gratuit.

   Avant que le site fonctionne, complète supabase-config.js avec les clés
   de TON projet Supabase, et suis le guide SETUP-SUPABASE.md fourni à côté
   de ce fichier (création du projet, des tables, des règles de sécurité,
   et du bucket de fichiers).
   ========================================================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const BUCKET = "uploads";

// Ton adresse email (celle avec laquelle tu crées ton compte sur le site)
// est automatiquement administrateur permanent — appliqué côté base de
// données par un déclencheur (trigger), voir SETUP-SUPABASE.md. Renseigne
// la même adresse ici pour l'affichage (badge couronne) côté interface.
const CREATOR_EMAIL = "kine33zwonder@gmail.com";

// Polices proposées dans l'éditeur de texte enrichi
const Font = Quill.import('formats/font');
Font.whitelist = ['sans-serif', 'serif', 'monospace'];
Quill.register(Font, true);

const quill = new Quill('#pub-desc-editor', {
    theme: 'snow',
    modules: {
        toolbar: {
            container: '#pub-desc-toolbar',
            handlers: { image: handleEditorImage }
        }
    },
    placeholder: 'Rédigez le contenu de votre article ou document...'
});

// Bouton "image" de la barre d'outils : ouvre un sélecteur de fichier,
// téléverse l'image choisie sur Supabase Storage, l'insère dans le texte
// à l'endroit du curseur (URL réelle, pas une image encodée en base64 qui
// alourdirait inutilement la base de données), puis propose d'ajouter une
// légende affichée juste en dessous.
function handleEditorImage() {
    if (!currentUser) {
        alert("Connecte-toi pour insérer une image.");
        return;
    }
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) {
            alert("Cette image est trop lourde (max 5 Mo). Choisis-en une plus légère.");
            return;
        }
        const loadingLabel = "Envoi de l'image en cours...";
        const range = quill.getSelection(true) || { index: quill.getLength() };
        quill.insertText(range.index, loadingLabel, 'italic', true);
        try {
            const url = await uploadFile(file, 'content-images');
            quill.deleteText(range.index, loadingLabel.length);
            quill.insertEmbed(range.index, 'image', url, 'user');

            let cursor = range.index + 1;
            quill.insertText(cursor, '\n', 'user');
            cursor += 1;

            const caption = prompt("Légende de l'image (facultatif, laisse vide pour ne rien ajouter) :");
            if (caption && caption.trim()) {
                quill.insertText(cursor, caption.trim(), { italic: true, size: 'small' }, 'user');
                cursor += caption.trim().length;
                quill.insertText(cursor, '\n', 'user');
                cursor += 1;
            }
            quill.setSelection(cursor, 0);
        } catch (err) {
            quill.deleteText(range.index, loadingLabel.length);
            alert("L'envoi de l'image a échoué. Réessaie.");
        }
    };
}

window.editorUndo = function () { quill.history.undo(); };
window.editorRedo = function () { quill.history.redo(); };

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || '').toLowerCase();
}

// Mots-clés obligatoires axés sur les sujets principaux du site
const allowedMedicalKeywords = [
    'kine', 'kinesitherapie', 'kinésithérapie', 'anatomie', 'pathologie', 'physiologie',
    'muscle', 'os', 'articulation', 'tendon', 'ligament', 'reeducation', 'rééducation',
    'douleur', 'fracture', 'entorse', 'geriatrie', 'gériatrie', 'neurologie', 'rhumatologie',
    'massage', 'etirement', 'étirement', 'renfocement', 'genou', 'epaule', 'colonne', 'vertebre',
    'scoliose', 'algodystrophie', 'sdrc', 'biomecanique', 'biomécanique', 'posture', 'statique',
    'bassin', 'membre', 'traitement', 'memoire', 'rapport', 'cours', 'stage','boiterie'
    'innèrvation', 'système nerveux', 'innervation motrice', 'innervation sensitive',
    'arthrose', 'mémoire', 'tendinite', 'arthrite','physiothérapie','vascularisation',
    'Goniomètre', 'goniometre', 'amplitude articulaire', 'bilan articulaire',
    'neurone', 'syndrome canalaire', 'imagérie', 'imagérie médicale', 'vision', 'vue','paralysie',
    'gustation', 'olfaction', 'communication nerveuse', 'plexus brachial', 'physiologie renale',
    'physiologie sanguine', 'physiologie musculaire', 'cruralgie', 'système nerveux',
    'système nerveux central', 'système nerveux périphérique', 'système nerveux sympathique', 
    'système nerveuxz parasympathique','système nerveux autonome', 'bilan kinésithérapique'
]
/* ================================ ÉTAT =================================== */

let articlesDatabase = [];
let documentsDatabase = [];

let currentUser = null;       // { id, email, username, role }
let currentMainTab = 'articles';
let currentAuthMode = 'login';
let currentPubType = 'article';

let selectedCategory = 'all'; // 'all' = toutes les catégories
let currentSearchKeyword = '';
let sortMode = 'recent';
let currentPage = 1;
const RESULTS_PER_PAGE = 6;

/* ============================ CHARGEMENT DES DONNÉES ======================= */

async function loadArticles() {
    const { data, error } = await supabase
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { console.error("Erreur de lecture des articles :", error); return; }
    articlesDatabase = data;
    if (currentMainTab === 'articles') renderCurrentView();
}

async function loadDocuments() {
    const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { console.error("Erreur de lecture des documents :", error); return; }
    documentsDatabase = data;
    if (currentMainTab === 'documents') renderCurrentView();
}

// Rafraîchit les listes en direct pour tout le monde : dès qu'une personne
// publie ou supprime un élément, les autres visiteurs connectés voient la
// mise à jour sans recharger la page.
supabase.channel('public:articles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, loadArticles)
    .subscribe();

supabase.channel('public:documents')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, loadDocuments)
    .subscribe();

/* =============================== SESSION =================================== */

async function loadProfile(userId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) { console.error("Erreur de lecture du profil :", error); return null; }
    return data;
}

async function refreshSessionFromAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        const profile = await loadProfile(user.id);
        currentUser = profile ? {
            id: user.id, email: user.email, username: profile.username,
            role: profile.role || 'membre'
        } : { id: user.id, email: user.email, username: user.email, role: 'membre' };
    } else {
        currentUser = null;
    }
    restoreSessionUI();
    renderCurrentView();
}

supabase.auth.onAuthStateChange(() => {
    refreshSessionFromAuth();
});

document.addEventListener("DOMContentLoaded", () => {
    refreshSessionFromAuth();
    loadArticles();
    loadDocuments();

    document.getElementById('search-input').addEventListener('input', (e) => {
        currentSearchKeyword = e.target.value.toLowerCase();
        currentPage = 1;
        renderCurrentView();
    });

    document.getElementById('sort-select').addEventListener('change', (e) => {
        sortMode = e.target.value;
        currentPage = 1;
        renderCurrentView();
    });
});

function restoreSessionUI() {
    const statusBadge = document.getElementById('status-badge');
    const logoutBtn = document.getElementById('btn-logout');
    const authSection = document.getElementById('auth-section');
    const addZone = document.getElementById('add-article-zone');
    const adminBtn = document.getElementById('btn-admin');

    if (currentUser) {
        const roleTag = currentUser.role === 'admin' ? ' (admin)' : '';
        statusBadge.innerText = `Connecté : ${currentUser.username}${roleTag}`;
        logoutBtn.style.display = 'inline-block';
        authSection.style.display = 'none';
        addZone.style.display = 'block';
        adminBtn.style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
    } else {
        statusBadge.innerText = 'Mode Invité';
        logoutBtn.style.display = 'none';
        authSection.style.display = 'block';
        addZone.style.display = 'none';
        adminBtn.style.display = 'none';
    }
}

window.handleLogout = async function () {
    await supabase.auth.signOut();
};

/* ============================ QUI SOMMES-NOUS ============================= */

window.openAboutModal = function () {
    document.getElementById('about-modal').style.display = 'flex';
};
window.closeAboutModal = function () {
    document.getElementById('about-modal').style.display = 'none';
};

/* ========================== NAVIGATION / AFFICHAGE ========================= */

window.switchMainTab = function (tab) {
    currentMainTab = tab;
    currentPage = 1;
    const btnArt = document.getElementById('btn-tab-articles');
    const btnDocs = document.getElementById('btn-tab-docs');
    const title = document.getElementById('display-title');

    if (tab === 'articles') {
        btnArt.className = 'btn btn-primary';
        btnArt.style.background = '';
        btnDocs.className = 'btn';
        btnDocs.style.background = 'rgba(255,255,255,0.6)';
        title.innerText = "Articles publiés";
    } else {
        btnDocs.className = 'btn btn-primary';
        btnDocs.style.background = '';
        btnArt.className = 'btn';
        btnArt.style.background = 'rgba(255,255,255,0.6)';
        title.innerText = "Documents, Cours & Mémoires";
    }
    renderCurrentView();
};

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, keyword) {
    const escaped = escapeHtml(text);
    if (!keyword) return escaped;
    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(`(${safeKeyword})`, 'ig'), '<mark>$1</mark>');
}

function renderCurrentView() {
    const grid = document.getElementById('content-grid');
    const countEl = document.getElementById('results-count');
    const kw = currentSearchKeyword;
    let dataset = (currentMainTab === 'articles') ? articlesDatabase : documentsDatabase;

    if (selectedCategory !== 'all') {
        dataset = dataset.filter(item => item.category === selectedCategory);
    }

    if (kw) {
        dataset = dataset.filter(item =>
            item.title.toLowerCase().includes(kw) ||
            stripHtml(item.description).includes(kw) ||
            item.keywords.toLowerCase().includes(kw)
        );
    }

    dataset = [...dataset].sort((a, b) => {
        if (sortMode === 'title') return a.title.localeCompare(b.title);
        if (sortMode === 'views') return (b.views || 0) - (a.views || 0);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const total = dataset.length;
    const noun = currentMainTab === 'articles' ? 'article' : 'document';
    countEl.innerText = kw
        ? `${total} ${noun}${total !== 1 ? 's' : ''} trouvé${total !== 1 ? 's' : ''} pour "${currentSearchKeyword}"`
        : `${total} ${noun}${total !== 1 ? 's' : ''} disponible${total !== 1 ? 's' : ''}`;

    const totalPages = Math.max(1, Math.ceil(total / RESULTS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageItems = dataset.slice((currentPage - 1) * RESULTS_PER_PAGE, currentPage * RESULTS_PER_PAGE);

    grid.innerHTML = "";
    if (pageItems.length === 0) {
        grid.innerHTML = `<p style="text-align:center; color:var(--text-light); padding: 2rem 0;">Aucun résultat.</p>`;
    } else {
        pageItems.forEach(item => grid.appendChild(buildResultCard(item, kw)));
    }
    renderPagination(totalPages);
}

function buildResultCard(item, kw) {
    const card = document.createElement('div');
    card.className = 'card';
    const canManage = currentUser && (currentUser.id === item.author_id || currentUser.role === 'admin');
    const isArticle = !item.total_pages;
    const plainDesc = stripHtml(item.description);
    const excerptRaw = plainDesc.slice(0, 220);
    const excerptHtml = highlight(excerptRaw, kw) + (plainDesc.length > 220 ? '…' : '');
    const titleHtml = highlight(item.title, kw);
    const keywordsHtml = highlight(item.keywords, kw);
    const year = item.created_at ? new Date(item.created_at).getFullYear() : '';
    const imgHtml = (isArticle && item.image_url) ? `<img src="${item.image_url}" alt="Illustration de l'article : ${item.title}">` : '';

    card.innerHTML = `
        <div>
            ${imgHtml}
            <span class="tag">${item.category}</span>
            <h3>${isArticle ? '' : '📄 '}${titleHtml}</h3>
            <p class="result-meta">Par ${item.author_name || 'anonyme'}${year ? ' · ' + year : ''} · ${item.views || 0} lecture(s)${!isArticle ? ' · ' + (item.downloads || 0) + ' téléchargement(s)' : ''}</p>
            <p>${excerptHtml}</p>
            <div class="keywords-display">Mots-clés : ${keywordsHtml}</div>
            ${!isArticle ? `<p style="font-size:0.85rem; color:var(--text-light);">Total : ${item.total_pages} pages</p>` : ''}
        </div>
        <div class="card-actions">
            <button class="btn btn-primary" onclick="${isArticle ? `readArticle('${item.id}')` : `readDocument('${item.id}')`}" style="font-size:0.9rem; padding:0.6rem 1.2rem; border-radius: 8px;">Lire${isArticle ? " l'article" : ''}</button>
            ${!isArticle ? `<button class="btn" onclick="downloadDocument('${item.id}')" style="background: rgba(20,184,166,0.2); color: var(--primary); font-size:0.9rem; padding:0.6rem 1rem; border-radius: 8px;">Télécharger</button>` : ''}
            ${currentUser ? `<button class="btn" onclick="reportItem('${item.id}', '${isArticle ? 'article' : 'document'}')" title="Signaler" style="background: rgba(255,255,255,0.6); border: 1px solid var(--ice-border); padding:0.6rem;">🚩</button>` : ''}
            ${canManage ? `<button class="btn btn-danger" onclick="deleteItem('${item.id}', '${isArticle ? 'article' : 'document'}')" title="Supprimer">🗑️</button>` : ''}
        </div>
    `;
    return card;
}

function renderPagination(totalPages) {
    const el = document.getElementById('pagination-controls');
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    let html = `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">«</button>`;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2) {
            html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
        } else if (p === currentPage - 3 || p === currentPage + 3) {
            html += `<span class="page-ellipsis">…</span>`;
        }
    }
    html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">»</button>`;
    el.innerHTML = html;
}

window.goToPage = function (page) {
    currentPage = page;
    renderCurrentView();
    document.querySelector('.results-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.filterCategory = function (category) {
    selectedCategory = category;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.category === category));
    currentPage = 1;
    renderCurrentView();
};

/* ==================== LIAISON VERS UN AUTRE ARTICLE/DOCUMENT =============== */

window.openLinkPicker = function () {
    renderLinkPickerList('');
    document.getElementById('link-picker-modal').style.display = 'flex';
};
window.closeLinkPicker = function () {
    document.getElementById('link-picker-modal').style.display = 'none';
};

function renderLinkPickerList(filter) {
    const all = [
        ...articlesDatabase.map(a => ({ id: a.id, title: a.title, kind: 'article' })),
        ...documentsDatabase.map(d => ({ id: d.id, title: d.title, kind: 'document' }))
    ].filter(i => i.title.toLowerCase().includes(filter.toLowerCase()));

    const list = document.getElementById('link-picker-list');
    list.innerHTML = all.length ? all.map(i => `
        <button type="button" class="btn" style="text-align:left; background:rgba(255,255,255,0.6); border:1px solid var(--ice-border); justify-content:flex-start;"
            onclick="insertContentLink('${i.id}', '${i.kind}', ${JSON.stringify(i.title)})">
            ${i.kind === 'article' ? '📝' : '📄'} ${i.title}
        </button>
    `).join('') : '<p style="color:var(--text-light);">Aucun résultat.</p>';
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('link-picker-search').addEventListener('input', (e) => {
        renderLinkPickerList(e.target.value);
    });
});

window.insertContentLink = function (id, kind, title) {
    const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
    quill.insertText(range.index, title, 'link', `#${kind}-${id}`);
    quill.setSelection(range.index + title.length, 0);
    closeLinkPicker();
};

// Un clic sur un lien inséré via "Lier vers un article/document" ouvre ce
// contenu directement dans le site, plutôt que de suivre un lien mort.
document.getElementById('content-grid').addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#article-"], a[href^="#document-"]');
    if (!link) return;
    e.preventDefault();
    const match = link.getAttribute('href').match(/^#(article|document)-(.+)$/);
    if (!match) return;
    if (match[1] === 'article') readArticle(match[2]); else readDocument(match[2]);
});
document.getElementById('read-modal-body').addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#article-"], a[href^="#document-"]');
    if (!link) return;
    e.preventDefault();
    const match = link.getAttribute('href').match(/^#(article|document)-(.+)$/);
    if (!match) return;
    closeReadModal();
    if (match[1] === 'article') readArticle(match[2]); else readDocument(match[2]);
});

/* ============================ FENÊTRE DE LECTURE ============================ */

function openReadModal(title, html) {
    document.getElementById('read-modal-title').innerText = title;
    document.getElementById('read-modal-body').innerHTML = DOMPurify.sanitize(html || '');
    document.getElementById('read-modal').style.display = 'flex';
}
window.closeReadModal = function () {
    document.getElementById('read-modal').style.display = 'none';
};

/* ============================ FORMULAIRE PUBLICATION ======================= */

window.togglePubFormType = function () {
    const selector = document.getElementById('pub-type-selector').value;
    currentPubType = selector;
    const dynamicFields = document.getElementById('dynamic-file-fields');
    const formTitle = document.getElementById('form-section-title');
    const submitBtn = document.getElementById('submit-pub-btn');

    if (selector === 'article') {
        formTitle.innerText = "Publier un nouvel article";
        submitBtn.innerText = "Publier l'article";
        dynamicFields.innerHTML = `
            <label style="text-align: left; font-size: 0.9rem; color: var(--text-light); display: block; margin-bottom: 0.3rem;">Image d'illustration :</label>
            <input type="file" id="pub-image" accept="image/*" class="register-input" style="width: 100%; margin-bottom: 1rem; background: rgba(255,255,255,0.8);">
        `;
    } else {
        formTitle.innerText = "Téléverser un document / cours";
        submitBtn.innerText = "Téléverser le document";
        dynamicFields.innerHTML = `
            <label style="text-align: left; font-size: 0.9rem; color: var(--text-light); display: block; margin-bottom: 0.3rem;">Fichier (PDF, Word, PowerPoint) :</label>
            <input type="file" id="pub-file" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt" class="register-input" style="width: 100%; margin-bottom: 1rem; background: rgba(255,255,255,0.8);" required>
            <input type="number" class="register-input" id="pub-pages" placeholder="Nombre total de pages" min="1" required style="width: 100%; margin-bottom: 1rem;">
        `;
    }
};

/* =============================== AUTHENTIFICATION =========================== */

window.openAuthModal = function (mode) {
    currentAuthMode = mode;
    const usernameInput = document.getElementById('auth-username');
    document.getElementById('auth-error').style.display = 'none';

    if (mode === 'signup') {
        document.getElementById('modal-title').innerText = 'Créer un compte';
        document.getElementById('auth-submit-btn').innerText = "S'inscrire";
        usernameInput.style.display = 'block';
        usernameInput.required = true;
    } else {
        document.getElementById('modal-title').innerText = 'Connexion';
        document.getElementById('auth-submit-btn').innerText = 'Se connecter';
        usernameInput.style.display = 'none';
        usernameInput.required = false;
    }
    document.getElementById('auth-modal').style.display = 'flex';
};

window.closeModal = function () {
    document.getElementById('auth-modal').style.display = 'none';
};

const authErrorMessages = {
    'User already registered': "Cet email est déjà associé à un compte. Essayez de vous connecter plutôt.",
    'Invalid login credentials': "Email ou mot de passe incorrect.",
    'Password should be at least 6 characters': "Le mot de passe doit contenir au moins 6 caractères.",
    'Unable to validate email address: invalid format': "L'adresse email n'est pas valide.",
    'Email rate limit exceeded': "Trop de tentatives. Réessayez dans quelques minutes."
};

window.handleAuthSubmit = async function (event) {
    event.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit-btn');
    const errorBox = document.getElementById('auth-error');
    errorBox.style.display = 'none';

    submitBtn.disabled = true;
    const originalLabel = submitBtn.innerText;
    submitBtn.innerText = 'Un instant...';

    try {
        if (currentAuthMode === 'signup') {
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;

            // Le déclencheur SQL "set_creator_admin" force le rôle admin
            // automatiquement si l'email correspond au créateur (voir
            // SETUP-SUPABASE.md) — ici on crée simplement le profil.
            const { error: profileError } = await supabase.from('profiles').insert({
                id: data.user.id, username, email, role: 'membre'
            });
            if (profileError) throw profileError;
        } else {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
        }
        closeModal();
        document.getElementById('auth-form').reset();
        // onAuthStateChange se charge de mettre à jour l'interface via
        // refreshSessionFromAuth().
    } catch (err) {
        errorBox.innerText = authErrorMessages[err.message] || "Une erreur est survenue. Réessayez.";
        errorBox.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalLabel;
    }
};

/* ================================ LECTURE ================================== */

window.readArticle = async function (id) {
    const art = articlesDatabase.find(a => a.id === id);
    if (!art) return;
    openReadModal(art.title, art.description);
    await supabase.rpc('increment_article_views', { article_id: id });
};

window.readDocument = async function (id) {
    const docItem = documentsDatabase.find(d => d.id === id);
    if (!docItem) return;

    if (!currentUser && docItem.total_pages > 10) {
        alert(`Mode Invité : Ce document compte ${docItem.total_pages} pages. En tant qu'invité, vous ne pouvez lire que les 10 premières pages. Connectez-vous pour un accès complet.`);
        return;
    }
    openReadModal(`${docItem.title} (${docItem.total_pages} pages)`, docItem.description);
    await supabase.rpc('increment_document_views', { doc_id: id });
};

window.downloadDocument = async function (id) {
    const docItem = documentsDatabase.find(d => d.id === id);
    if (!docItem) return;

    if (!currentUser) {
        alert("Téléchargement réservé aux utilisateurs inscrits. Veuillez vous connecter ou créer un compte.");
        openAuthModal('login');
        return;
    }

    if (!docItem.file_url) {
        alert(`Aucun fichier n'a été conservé pour "${docItem.title}".`);
        return;
    }

    await supabase.rpc('increment_document_downloads', { doc_id: id });

    const link = document.createElement('a');
    link.href = docItem.file_url;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/* ================================ SIGNALEMENT ================================ */

window.reportItem = async function (itemId, itemType) {
    if (!currentUser) return;
    const reason = prompt("Pourquoi signalez-vous ce contenu ? (hors-sujet, contenu inapproprié, erreur...)");
    if (reason === null) return;
    const { error } = await supabase.from('reports').insert({
        item_id: itemId, item_type: itemType, reason,
        reporter_id: currentUser.id, reporter_name: currentUser.username
    });
    alert(error ? "Le signalement n'a pas pu être envoyé." : "Merci, ce contenu a été signalé pour vérification.");
};

/* ================================ PUBLICATION =============================== */

async function uploadFile(file, subfolder) {
    const path = `${currentUser.id}/${subfolder}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

window.handlePublish = async function (event) {
    event.preventDefault();
    if (!currentUser) return;

    const title = document.getElementById('pub-title').value.trim();
    const category = document.getElementById('pub-cat').value;
    const keywordsInput = document.getElementById('pub-keywords').value.trim();
    const description = DOMPurify.sanitize(quill.root.innerHTML);
    const submitBtn = document.getElementById('submit-pub-btn');

    if (!quill.getText().trim()) {
        alert("Le contenu de l'article ou du document ne peut pas être vide.");
        return;
    }

    const userWords = keywordsInput.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const hasValidKeyword = userWords.some(word => allowedMedicalKeywords.some(medWord => word.includes(medWord)));

    if (!hasValidKeyword) {
        alert("Publication refusée : Les mots-clés doivent obligatoirement être en rapport avec la kinésithérapie, l'anatomie, les pathologies, la physiologie ou les techniques kiné.");
        return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.innerText;
    submitBtn.innerText = 'Publication en cours...';

    try {
        if (currentPubType === 'article') {
            const imageInput = document.getElementById('pub-image');
            const file = imageInput.files && imageInput.files[0];
            let imageUrl = '';

            if (file) {
                if (file.size > MAX_FILE_SIZE) {
                    alert("L'image est trop lourde (max 5 Mo). Choisissez une image plus légère.");
                    return;
                }
                imageUrl = await uploadFile(file, 'articles');
            }

            const { error } = await supabase.from('articles').insert({
                category, title, keywords: keywordsInput, description,
                image_url: imageUrl,
                author_id: currentUser.id,
                author_name: currentUser.username
            });
            if (error) throw error;

            await supabase.rpc('register_publication', {
                p_user_id: currentUser.id, p_type: 'article', p_category: category
            });
            alert('Votre article a été publié avec succès !');
        } else {
            const fileInput = document.getElementById('pub-file');
            const totalPages = parseInt(document.getElementById('pub-pages').value) || 1;
            const file = fileInput.files && fileInput.files[0];
            let fileUrl = '';
            let fileName = file ? file.name : 'document.pdf';

            if (file) {
                if (file.size > MAX_FILE_SIZE) {
                    alert("Le fichier dépasse 5 Mo, taille maximale autorisée. Choisissez un fichier plus léger ou compressez-le.");
                    return;
                }
                fileUrl = await uploadFile(file, 'documents');
            }

            const { error } = await supabase.from('documents').insert({
                category, title, keywords: keywordsInput, description,
                total_pages: totalPages, file_name: fileName, file_url: fileUrl,
                author_id: currentUser.id,
                author_name: currentUser.username
            });
            if (error) throw error;

            await supabase.rpc('register_publication', {
                p_user_id: currentUser.id, p_type: 'document', p_category: category
            });
            alert('Votre document a été téléversé avec succès !');
        }

        // Le rôle a pu changer (promotion automatique) : on rafraîchit la session.
        await refreshSessionFromAuth();
        document.getElementById('main-pub-form').reset();
        quill.setContents([]);
        togglePubFormType();
    } catch (err) {
        console.error(err);
        alert("La publication a échoué. Vérifiez votre connexion et réessayez.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalLabel;
    }
};

/* ================================ SUPPRESSION ================================ */

window.deleteItem = async function (id, type) {
    if (!confirm("Voulez-vous vraiment supprimer cet élément ?")) return;

    const table = type === 'article' ? 'articles' : 'documents';
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) {
        console.error(error);
        alert("La suppression a échoué.");
    }
    // Les fichiers déjà téléversés restent dans le bucket Storage ; ils
    // peuvent être nettoyés manuellement depuis le tableau de bord Supabase
    // si besoin (Storage > uploads).
};
