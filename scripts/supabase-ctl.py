#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Do It Laaaaaater 数据接管工具（Supabase REST）。

用法：
  python scripts/supabase-ctl.py items [limit]       列出收藏（默认 20）
  python scripts/supabase-ctl.py search <关键词>     搜索标题
  python scripts/supabase-ctl.py get <id>            查看一条详情
  python scripts/supabase-ctl.py add-text <标题>     添加文字条目
  python scripts/supabase-ctl.py add-link <标题> <url>
  python scripts/supabase-ctl.py done <id>           标记完成
  python scripts/supabase-ctl.py pending <id>        恢复待处理
  python scripts/supabase-ctl.py category <id> <分类名>  改分类
  python scripts/supabase-ctl.py star <id>           加星标
  python scripts/supabase-ctl.py unstar <id>         取消星标
  python scripts/supabase-ctl.py trash <id>          移到回收站
  python scripts/supabase-ctl.py del <id>            彻底删除（不可恢复）
  python scripts/supabase-ctl.py categories          列出分类（含 id）
  python scripts/supabase-ctl.py stats               统计

凭证从项目根 .env 读取（SUPABASE_URL / SUPABASE_ANON_KEY /
SUPABASE_EMAIL / SUPABASE_PASSWORD）。走 HTTPS_PROXY 环境变量代理。
"""
import json
import os
import sys
import urllib.request
import urllib.parse
from pathlib import Path


def load_env() -> dict:
    env: dict[str, str] = {}
    p = Path(__file__).resolve().parent.parent / ".env"
    if not p.exists():
        sys.exit("未找到 .env（项目根目录）")
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def api(method: str, path: str, token: str, body: dict | None = None) -> dict | list:
    env = load_env()
    url = env["VITE_SUPABASE_URL"].rstrip("/") + path
    headers = {
        "apikey": env["VITE_SUPABASE_ANON_KEY"],
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def login() -> tuple[str, str]:
    env = load_env()
    body = json.dumps(
        {"email": env["SUPABASE_EMAIL"], "password": env["SUPABASE_PASSWORD"]}
    ).encode()
    url = env["VITE_SUPABASE_URL"].rstrip("/") + "/auth/v1/token?grant_type=password"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": env["VITE_SUPABASE_ANON_KEY"],
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        d = json.loads(resp.read())
    return d["access_token"], d["user"]["id"]


def print_item(i: dict) -> None:
    mark = "★" if i.get("is_starred") else " "
    state = "✓" if i.get("status") == "completed" else "·"
    cat = i.get("category") or ""
    print(
        f"  {mark}{state} [{i.get('kind',''):11}] {cat:4} {i.get('title','')[:40]}  ({i['id']})"
    )


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    token, uid = login()

    if cmd == "items":
        limit = sys.argv[2] if len(sys.argv) > 2 else "20"
        items = api(
            "GET",
            f"/rest/v1/items?select=id,kind,title,url,status,is_starred,created_at&order=created_at.desc&limit={limit}",
            token,
        )
        print(f"共 {len(items)} 条收藏：")
        for i in items:
            print_item(i)
    elif cmd == "search":
        kw = " ".join(sys.argv[2:])
        if not kw:
            print("需要关键词")
            sys.exit(1)
        items = api(
            "GET",
            f"/rest/v1/items?select=id,kind,title,url,status,is_starred&order=created_at.desc&limit=50",
            token,
        )
        hits = [i for i in items if kw.lower() in (i.get("title") or "").lower()]
        print(f"找到 {len(hits)} 条包含「{kw}」的收藏：")
        for i in hits:
            print_item(i)
    elif cmd == "get":
        iid = sys.argv[2]
        item = api("GET", f"/rest/v1/items?select=*&id=eq.{iid}", token)
        if not item:
            print("未找到")
            sys.exit(1)
        for k, v in item[0].items():
            print(f"{k}: {v}")
    elif cmd == "add-text":
        title = " ".join(sys.argv[2:])
        if not title:
            print("需要标题")
            sys.exit(1)
        r = api(
            "POST",
            "/rest/v1/items",
            token,
            {
                "user_id": uid,
                "kind": "text",
                "title": title,
                "status": "pending",
                "is_starred": False,
            },
        )
        print("已添加:", r[0]["id"] if isinstance(r, list) and r else r)
    elif cmd == "add-link":
        if len(sys.argv) < 4:
            print("用法: add-link <标题> <url>")
            sys.exit(1)
        title = " ".join(sys.argv[2:-1])
        url = sys.argv[-1]
        r = api(
            "POST",
            "/rest/v1/items",
            token,
            {
                "user_id": uid,
                "kind": "link",
                "title": title,
                "url": url,
                "status": "pending",
                "is_starred": False,
            },
        )
        print("已添加:", r[0]["id"] if isinstance(r, list) and r else r)
    elif cmd in ("done", "pending"):
        iid = sys.argv[2]
        st = "completed" if cmd == "done" else "pending"
        r = api("PATCH", f"/rest/v1/items?id=eq.{iid}", token, {"status": st})
        print("已更新:", r[0]["status"] if isinstance(r, list) and r else r)
    elif cmd == "category":
        if len(sys.argv) < 4:
            print("用法: category <id> <分类名>")
            sys.exit(1)
        iid = sys.argv[2]
        name = " ".join(sys.argv[3:])
        cats = api("GET", "/rest/v1/categories?select=id,name&order=name", token)
        hit = next((c for c in cats if c.get("name") == name), None)
        if not hit:
            print(f"分类「{name}」不存在。现有分类：")
            for c in cats:
                print("  ", c.get("name"))
            sys.exit(1)
        r = api("PATCH", f"/rest/v1/items?id=eq.{iid}", token, {"category_id": hit["id"]})
        print(f"已改分类为「{name}」")
    elif cmd == "star" or cmd == "unstar":
        iid = sys.argv[2]
        val = 1 if cmd == "star" else 0
        r = api("PATCH", f"/rest/v1/items?id=eq.{iid}", token, {"is_starred": val})
        print("已更新星标")
    elif cmd == "trash":
        import datetime

        iid = sys.argv[2]
        ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
        r = api("PATCH", f"/rest/v1/items?id=eq.{iid}", token, {"trashed_at": ts})
        print("已移到回收站")
    elif cmd == "del":
        iid = sys.argv[2]
        if input(f"确认彻底删除 {iid}？(y/N) ").lower() != "y":
            print("已取消")
            sys.exit(0)
        api("DELETE", f"/rest/v1/items?id=eq.{iid}", token)
        print("已彻底删除")
    elif cmd == "categories":
        cats = api("GET", "/rest/v1/categories?select=id,name,color&order=name", token)
        for c in cats:
            print(f"  {c.get('name')} ({c.get('color')})  [{c.get('id')}]")
    elif cmd == "stats":
        items = api("GET", "/rest/v1/items?select=status,is_starred,trashed_at", token)
        pending = sum(1 for i in items if i.get("status") == "pending" and not i.get("trashed_at"))
        done = sum(1 for i in items if i.get("status") == "completed")
        star = sum(1 for i in items if i.get("is_starred"))
        trash = sum(1 for i in items if i.get("trashed_at"))
        print(f"收藏总数: {len(items)}  |  待处理: {pending}  |  已完成: {done}  |  星标: {star}  |  回收站: {trash}")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
