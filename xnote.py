#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "flask",
#     "pywebview",
#     "qtpy",
#     "PyQt6",
#     "PyQt6-WebEngine",
# ]
# ///

"""
xnote — Personal note-taking app (Hearth app).

Stores notes in SQLite database (xnote.db).

Run:
    [uv run] xnote.py                   # native window
    [uv run] xnote.py --serve [PORT]    # LAN web access

Developer:  KarmaHelen
Contact:    xnote.cusp743@passinbox.com
Support:    https://buymeacoffee.com/karmahelen
"""

import datetime
import json
import os
import shutil
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "xnote.db"
IMG_DIR = BASE_DIR / "images"

# Add parent directory to path so Hearth can be imported
sys.path.insert(0, str(BASE_DIR.parent))


class XNoteApp:

    def __init__(self):
        IMG_DIR.mkdir(exist_ok=True)
        self._init_db()

    # ── Private helpers ──────────────────────────────────────────────────

    def _init_db(self):
        conn = sqlite3.connect(DB_PATH)
        conn.executescript("""
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS notes (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                title         TEXT    NOT NULL,
                body          TEXT    DEFAULT '',
                date_created  TEXT    NOT NULL,
                date_modified TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            );

            CREATE TABLE IF NOT EXISTS note_tags (
                note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
                PRIMARY KEY (note_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)

        # Migration: add date_viewed column if it doesn't exist
        cols = [r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()]
        if "date_viewed" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN date_viewed TEXT")
            conn.execute("UPDATE notes SET date_viewed = date_modified WHERE date_viewed IS NULL")
            conn.commit()

        conn.close()

    @contextmanager
    def _db(self):
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _load_setting(self, key, default=""):
        with self._db() as conn:
            row = conn.execute(
                "SELECT value FROM settings WHERE key=?", (key,)
            ).fetchone()
        return row[0] if row else default

    def _save_setting(self, key, value):
        with self._db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value)
            )

    def _shutdown(self):
        pass

    # ── Notes CRUD ───────────────────────────────────────────────────────

    def get_recent_notes(self, limit=None):
        if limit is None:
            limit = int(self._load_setting("recent_notes_limit", "5"))
        with self._db() as conn:
            rows = conn.execute(
                "SELECT id, title, date_viewed FROM notes ORDER BY date_viewed DESC LIMIT ?",
                (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def get_all_notes(self, page=1, page_size=None, sort_by=None):
        if page_size is None:
            page_size = int(self._load_setting("all_notes_page_size", "10"))
        if sort_by is None:
            sort_by = self._load_setting("all_notes_sort", "date_viewed")

        sort_map = {
            "date_viewed": "date_viewed DESC",
            "date_modified": "date_modified DESC",
            "date_created": "date_created DESC",
            "title": "title COLLATE NOCASE ASC",
        }
        order = sort_map.get(sort_by, "date_viewed DESC")
        offset = (max(1, int(page)) - 1) * page_size

        with self._db() as conn:
            total = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
            rows = conn.execute(
                f"SELECT id, title, date_viewed, date_modified, date_created FROM notes ORDER BY {order} LIMIT ? OFFSET ?",
                (page_size, offset)
            ).fetchall()

        return {
            "notes": [dict(r) for r in rows],
            "total": total,
            "page": max(1, int(page)),
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    def search_notes(self, query):
        query = query.strip()
        if not query:
            return []

        with self._db() as conn:
            # Priority 1: exact phrase match in title, body, or tags
            exact = f"%{query}%"
            exact_rows = conn.execute("""
                SELECT DISTINCT n.id, n.title, n.date_modified
                FROM notes n
                LEFT JOIN note_tags nt ON n.id = nt.note_id
                LEFT JOIN tags t ON nt.tag_id = t.id
                WHERE n.title LIKE ? OR n.body LIKE ? OR t.name LIKE ?
                ORDER BY n.date_modified DESC
                LIMIT 20
            """, (exact, exact, exact)).fetchall()

            exact_ids = {r['id'] for r in exact_rows}
            results = [dict(r) for r in exact_rows]

            # Priority 2: all individual words must each appear somewhere
            words = query.split()
            if len(words) > 1:
                word_conditions = []
                params = []
                for word in words:
                    w = f"%{word}%"
                    word_conditions.append("""
                        n.id IN (
                            SELECT n2.id FROM notes n2
                            LEFT JOIN note_tags nt2 ON n2.id = nt2.note_id
                            LEFT JOIN tags t2 ON nt2.tag_id = t2.id
                            WHERE n2.title LIKE ? OR n2.body LIKE ? OR t2.name LIKE ?
                        )
                    """)
                    params.extend([w, w, w])

                where = " AND ".join(word_conditions)
                word_rows = conn.execute(f"""
                    SELECT DISTINCT n.id, n.title, n.date_modified
                    FROM notes n
                    WHERE {where}
                    ORDER BY n.date_modified DESC
                    LIMIT 20
                """, params).fetchall()

                for r in word_rows:
                    if r['id'] not in exact_ids:
                        results.append(dict(r))

            return results[:20]

    def get_note(self, note_id):
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._db() as conn:
            conn.execute(
                "UPDATE notes SET date_viewed = ? WHERE id = ?",
                (now, note_id)
            )
            note = conn.execute(
                "SELECT id, title, body, date_created, date_modified, date_viewed FROM notes WHERE id=?",
                (note_id,)
            ).fetchone()
            tags = conn.execute("""
                SELECT t.name FROM tags t
                JOIN note_tags nt ON t.id = nt.tag_id
                WHERE nt.note_id = ?
                ORDER BY t.name
            """, (note_id,)).fetchall()
        if not note:
            return None
        result = dict(note)
        result["tags"] = [r[0] for r in tags]
        return result

    def save_note(self, title, body, tags_str, note_id=None):
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        tag_list = [t.strip().lower() for t in tags_str.split(",") if t.strip()]

        with self._db() as conn:
            if note_id:
                conn.execute(
                    "UPDATE notes SET title=?, body=?, date_modified=? WHERE id=?",
                    (title, body, now, note_id)
                )
            else:
                cur = conn.execute(
                    "INSERT INTO notes (title, body, date_created, date_modified, date_viewed) VALUES (?,?,?,?,?)",
                    (title, body, now, now, now)
                )
                note_id = cur.lastrowid

            conn.execute("DELETE FROM note_tags WHERE note_id=?", (note_id,))
            for tag in tag_list:
                conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,))
                tag_id = conn.execute("SELECT id FROM tags WHERE name=?", (tag,)).fetchone()[0]
                conn.execute(
                    "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?,?)",
                    (note_id, tag_id)
                )
        return note_id

    def delete_note(self, note_id):
        with self._db() as conn:
            conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
        return True

    # ── Page routes (served as HTML via GET /page/note?note_id=...) ──────

    def page_note(self, note_id):
        """Render a note as a standalone HTML page for pop-out viewing."""
        import html as htmlmod
        import re

        note = self.get_note(int(note_id))
        if not note:
            return None

        safe_title = htmlmod.escape(note['title'])
        body = note.get("body", "") or ""

        # Detect if body is HTML or plain text
        html_tags = {'a','b','blockquote','br','code','div','em','h1','h2','h3',
                     'h4','h5','h6','hr','i','img','li','ol','p','pre','span',
                     'strong','sub','sup','table','tbody','td','th','thead','tr','u','ul'}
        is_html = False
        for m in re.finditer(r'</?([a-zA-Z][a-zA-Z0-9]*)', body):
            if m.group(1).lower() in html_tags:
                is_html = True
                break
        if not is_html:
            body = (body
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\n", "<br>\n"))

        # Rewrite relative image paths to absolute so they resolve from /page/...
        body = re.sub(r'src="images/', 'src="/images/', body)
        body = re.sub(r"src='images/", "src='/images/", body)

        palette = self.get_palette() or {}
        defaults = {
            'bg': '#0a0a0f', 'bg2': '#16161e', 'bg3': '#1e1e2a', 'entry': '#111118',
            'border': '#2a2a3a', 'fg': '#e8e8f0', 'fg2': '#6a6a80', 'accent': '#77ccff',
            'accent2': '#b07aff', 'green': '#3ad900', 'red': '#ff3366',
            'yellow': '#fbbf24', 'code': '#ff0099'
        }
        for k, v in defaults.items():
            palette.setdefault(k, v)

        font = self.get_font_family()

        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{safe_title}</title>
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
::-webkit-scrollbar {{ width: 6px; }}
::-webkit-scrollbar-track {{ background: transparent; }}
::-webkit-scrollbar-thumb {{ background: {palette['border']}; border-radius: 3px; }}
body {{
    background: {palette['bg']};
    color: {palette['fg']};
    font-family: '{font}', monospace;
    font-size: 14px;
    line-height: 1.8;
    padding: 28px 32px;
    overflow-y: auto;
    height: 100vh;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
}}
.title {{
    font-size: 20px;
    font-weight: 700;
    color: {palette['fg']};
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid {palette['border']};
}}
h1, h2, h3, h4 {{ color: {palette['accent']}; margin-top: 1.2em; margin-bottom: 0.4em; }}
a {{ color: {palette['accent']}; }}
strong {{ color: {palette['yellow']}; }}
em {{ color: {palette['accent2']}; }}
code {{
    background: {palette['bg3']};
    color: {palette['code']};
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.9em;
}}
pre {{
    background: {palette['bg3']};
    border-left: 3px solid {palette['accent']};
    padding: 14px 18px;
    overflow-x: auto;
    border-radius: 4px;
    margin: 12px 0;
}}
pre code {{ background: none; padding: 0; }}
table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
th {{ background: {palette['bg3']}; color: {palette['accent']}; padding: 8px 14px; text-align: left; border: 1px solid {palette['border']}; }}
td {{ padding: 8px 14px; border: 1px solid {palette['border']}; }}
tr:nth-child(even) {{ background: {palette['bg2']}; }}
blockquote {{ border-left: 3px solid {palette['accent2']}; margin: 12px 0; padding-left: 18px; color: {palette['fg2']}; }}
img {{ max-width: 100%; border-radius: 4px; margin: 8px 0; }}
ul, ol {{ padding-left: 24px; }}
li {{ margin: 4px 0; }}
hr {{ border: none; border-top: 1px solid {palette['border']}; margin: 20px 0; }}
p {{ margin: 8px 0; }}
</style></head>
<body>
<div class="title">{safe_title}</div>
{body}
</body></html>"""

    # ── File upload (image attachment) ───────────────────────────────────

    def handle_upload(self, filename, filepath):
        """Save uploaded image to the images directory."""
        dest = IMG_DIR / filename
        n = 1
        while dest.exists():
            stem, ext = os.path.splitext(filename)
            dest = IMG_DIR / f"{stem}_{n}{ext}"
            n += 1

        shutil.copy2(filepath, dest)
        return f'<img src="images/{dest.name}" alt="{dest.name}" style="max-width:100%;">'

    # ── Settings ─────────────────────────────────────────────────────────

    def get_palette(self):
        raw = self._load_setting("palette", "")
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                pass
        return None

    def save_palette(self, palette):
        self._save_setting("palette", json.dumps(palette))
        return True

    def get_font_family(self):
        return self._load_setting("font_family", "IBM Plex Mono")

    def save_font_family(self, family):
        self._save_setting("font_family", family)
        return True

    def get_recent_limit(self):
        return int(self._load_setting("recent_notes_limit", "5"))

    def save_recent_limit(self, limit):
        self._save_setting("recent_notes_limit", str(max(1, min(50, int(limit)))))
        return True

    def get_all_notes_page_size(self):
        return int(self._load_setting("all_notes_page_size", "10"))

    def save_all_notes_page_size(self, size):
        self._save_setting("all_notes_page_size", str(max(1, min(50, int(size)))))
        return True

    def get_all_notes_sort(self):
        return self._load_setting("all_notes_sort", "date_viewed")

    def save_all_notes_sort(self, sort_by):
        valid = {"date_viewed", "date_modified", "date_created", "title"}
        if sort_by not in valid:
            sort_by = "date_viewed"
        self._save_setting("all_notes_sort", sort_by)
        return True


# ─────────────────────────────────────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from hearth import run
    run(XNoteApp(), frontend=str(BASE_DIR / "xnote.html"), title="xnote", port=8080,
        window={
            'width': 740,
            'height': 420,
            'min_size': (500, 300),
            'background_color': '#0a0a0f',
            'text_select': True,
        })
