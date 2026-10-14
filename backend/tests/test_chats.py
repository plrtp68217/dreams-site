import pytest

from .conftest import register


@pytest.fixture
def other(client, admin):
    api = register(client, "other")
    admin.patch(f"/api/users/{api.user['id']}", json={"role": "editor"})
    return api


def make_chat(api, *members, title=""):
    r = api.post("/api/chats", json={"title": title, "member_ids": [m.user["id"] for m in members]})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_create_send_and_read(editor, admin):
    chat = make_chat(editor, admin, title="Арт")
    assert [m["username"] for m in chat["members"]] == ["editor", "admin"]
    assert chat["created_by"]["username"] == "editor"
    assert (chat["last_message"], chat["unread"]) == (None, 0)

    url = f"/api/chats/{chat['id']}/messages"
    first = editor.post(url, json={"text": "Привет, **команда**"}).json()
    assert "<strong>команда</strong>" in first["html"]
    second = editor.post(url, json={"text": "Второе\n\nсообщение"}).json()

    # the author has nothing unread; the other member has both messages
    assert editor.get("/api/chats/unread").json() == {"messages": 0, "chats": 0}
    assert admin.get("/api/chats/unread").json() == {"messages": 2, "chats": 1}
    listed = admin.get("/api/chats").json()
    assert listed[0]["unread"] == 2
    assert listed[0]["last_message"]["text"] == "Второе сообщение"
    assert listed[0]["last_message"]["author"]["username"] == "editor"

    assert [m["id"] for m in admin.get(url).json()] == [first["id"], second["id"]]
    assert [m["id"] for m in admin.get(url, params={"after": first["id"]}).json()] == [second["id"]]
    assert [m["id"] for m in admin.get(url, params={"before": second["id"]}).json()] == [first["id"]]
    assert [m["id"] for m in admin.get(url, params={"limit": 1}).json()] == [second["id"]]

    assert admin.put(f"/api/chats/{chat['id']}/read", json={"last_id": first["id"]}).status_code == 204
    assert admin.get("/api/chats/unread").json() == {"messages": 1, "chats": 1}
    admin.put(f"/api/chats/{chat['id']}/read", json={"last_id": second["id"]})
    admin.put(f"/api/chats/{chat['id']}/read", json={"last_id": 0})  # never goes back
    assert admin.get("/api/chats/unread").json() == {"messages": 0, "chats": 0}

    # chats are private: no trace in the activity feed
    assert not [i for i in admin.get("/api/activity").json()["items"] if i["entity_type"] == "chat"]


def test_chats_are_listed_by_last_message(editor, admin, other):
    a = make_chat(editor, admin, title="А")
    b = make_chat(editor, other, title="Б")
    assert [c["id"] for c in editor.get("/api/chats").json()] == [b["id"], a["id"]]
    editor.post(f"/api/chats/{a['id']}/messages", json={"text": "новое"})
    assert [c["id"] for c in editor.get("/api/chats").json()] == [a["id"], b["id"]]
    # each member sees only own chats
    assert [c["id"] for c in other.get("/api/chats").json()] == [b["id"]]


def test_only_members_and_team(editor, admin, other, viewer):
    chat = make_chat(editor, admin)
    url = f"/api/chats/{chat['id']}"
    for path in ("", "/messages"):
        assert other.get(url + path).status_code == 404
    assert other.post(url + "/messages", json={"text": "x"}).status_code == 404
    assert viewer.get("/api/chats").status_code == 403
    # only active team members can be invited
    assert editor.post("/api/chats", json={"member_ids": [viewer.user["id"]]}).status_code == 422
    assert editor.post("/api/chats", json={"member_ids": [999]}).status_code == 422
    assert editor.post("/api/chats", json={"member_ids": []}).status_code == 422
    assert editor.post("/api/chats", json={"member_ids": [editor.user["id"]]}).status_code == 422
    assert editor.post(url + "/messages", json={"text": "   "}).status_code == 422


def test_direct_chat_is_reused(editor, admin, other):
    first = make_chat(editor, admin)
    r = admin.post("/api/chats", json={"member_ids": [editor.user["id"]]})
    assert (r.status_code, r.json()["id"]) == (200, first["id"])
    # a titled chat of the same two is a separate one
    assert make_chat(editor, admin, title="Звук")["id"] != first["id"]
    # inviting a third person turns the direct chat into a named group
    grown = editor.post(f"/api/chats/{first['id']}/members", json={"user_ids": [other.user["id"]]}).json()
    assert grown["title"] == "Editor, Admin"
    assert len(grown["members"]) == 3
    assert make_chat(editor, admin)["id"] not in (first["id"],)


def test_members_rename_leave(editor, admin, other):
    chat = make_chat(editor, admin, title="Сон 1")
    url = f"/api/chats/{chat['id']}"
    editor.post(url + "/messages", json={"text": "до"})
    added = admin.post(url + "/members", json={"user_ids": [other.user["id"], admin.user["id"]]}).json()
    assert [m["username"] for m in added["members"]] == ["editor", "admin", "other"]
    # newcomers see the history but nothing is unread for them
    assert len(other.get(url + "/messages").json()) == 1
    assert other.get("/api/chats/unread").json()["messages"] == 0

    assert other.patch(url, json={"title": "  Сон 1: касса  "}).json()["title"] == "Сон 1: касса"
    # only the creator or an admin removes others; anyone may leave
    assert other.delete(f"{url}/members/{admin.user['id']}").status_code == 403
    assert other.delete(f"{url}/members/{other.user['id']}").status_code == 204
    assert other.get(url).status_code == 404
    assert editor.delete(f"{url}/members/{other.user['id']}").status_code == 404
    assert editor.delete(f"{url}/members/{admin.user['id']}").status_code == 204
    # the last one out deletes the chat
    assert editor.delete(f"{url}/members/{editor.user['id']}").status_code == 204
    assert editor.get("/api/chats").json() == []


def test_delete_message(editor, admin):
    chat = make_chat(editor, admin)
    url = f"/api/chats/{chat['id']}/messages"
    mine = editor.post(url, json={"text": "моё"}).json()
    theirs = admin.post(url, json={"text": "их"}).json()
    assert editor.delete(f"{url}/{theirs['id']}").status_code == 403
    assert editor.delete(f"{url}/999").status_code == 404
    assert editor.delete(f"{url}/{mine['id']}").status_code == 204
    assert admin.delete(f"{url}/{mine['id']}").status_code == 404
    assert [m["id"] for m in admin.get(url).json()] == [theirs["id"]]
    assert editor.get("/api/chats/unread").json()["messages"] == 1
