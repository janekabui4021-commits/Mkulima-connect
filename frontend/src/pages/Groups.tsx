import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createFarmerGroup,
  createFarmerGroupPost,
  createContentReport,
  getFarmerGroupPosts,
  getFarmerGroups,
  joinFarmerGroup,
} from "../api";
import type { FarmerGroup, FarmerGroupPost } from "../api";
import { useTranslation } from "../i18n";

const emptyGroup = { name: "", county: "", topic: "", description: "" };

export default function Groups() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<FarmerGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number>();
  const [posts, setPosts] = useState<FarmerGroupPost[]>([]);
  const [groupForm, setGroupForm] = useState(emptyGroup);
  const [postType, setPostType] = useState<"discussion" | "bulk_order">("discussion");
  const [postForm, setPostForm] = useState({
    body: "",
    produce_name: "",
    quantity: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const activeGroup = groups.find((group) => group.id === activeGroupId);

  const loadGroups = async () => {
    const availableGroups = await getFarmerGroups();
    setGroups(availableGroups);
  };

  useEffect(() => {
    loadGroups().catch((cause: unknown) => {
      setError(
        "Could not load farmer groups: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    });
  }, []);

  useEffect(() => {
    if (!activeGroupId || !activeGroup?.is_member) {
      setPosts([]);
      return;
    }
    getFarmerGroupPosts(activeGroupId)
      .then(setPosts)
      .catch((cause: unknown) => {
        setError(
          "Could not load group posts: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, [activeGroupId, activeGroup?.is_member]);

  const createGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await createFarmerGroup(groupForm);
      setGroupForm(emptyGroup);
      await loadGroups();
      setActiveGroupId(created.id);
      setMessage("Farmer group created. Share knowledge and coordinate interest.");
    } catch (cause) {
      setError(
        "Could not create group: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setBusy(false);
    }
  };

  const joinGroup = async (groupId: number) => {
    setError("");
    try {
      await joinFarmerGroup(groupId);
      await loadGroups();
      setActiveGroupId(groupId);
    } catch (cause) {
      setError(
        "Could not join group: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const reportGroup = async (group: FarmerGroup) => {
    const reason = window.prompt(`Why are you reporting ${group.name}?`);
    if (reason === null) return;
    setError("");
    try {
      await createContentReport("group", group.id, reason);
      setMessage("Report sent to marketplace administrators.");
    } catch (cause) {
      setError(
        "Could not submit report: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const reportUser = async (userId: number, name: string) => {
    const reason = window.prompt(`Why are you reporting ${name}?`);
    if (reason === null) return;
    setError("");
    try {
      await createContentReport("user", userId, reason);
      setMessage("Report sent to marketplace administrators.");
    } catch (cause) {
      setError(
        "Could not submit report: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeGroupId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createFarmerGroupPost(activeGroupId, {
        post_type: postType,
        body: postForm.body,
        ...(postType === "bulk_order"
          ? {
              produce_name: postForm.produce_name,
              quantity: Number(postForm.quantity),
            }
          : {}),
      });
      setPostForm({ body: "", produce_name: "", quantity: "" });
      setPosts(await getFarmerGroupPosts(activeGroupId));
      setMessage("Your post was shared with the group.");
    } catch (cause) {
      setError(
        "Could not publish group post: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>{t("Farmer groups")}</h2>
      <p className="mut">
        Share farming knowledge with farmers in your county. Bulk-order posts
        help farmers find others interested in combining demand; arrange orders
        and payment directly.
      </p>
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice success">{message}</p>}

      <form className="card product-form" onSubmit={(event) => void createGroup(event)}>
        <h3>{t("Create a group")}</h3>
        <div className="form-grid">
          <label className="form-field">
            {t("Group name")}
            <input
              required
              minLength={2}
              maxLength={100}
              value={groupForm.name}
              onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })}
              placeholder="e.g. Nakuru tomato growers"
            />
          </label>
          <label className="form-field">
            {t("County")}
            <input
              required
              minLength={2}
              maxLength={80}
              value={groupForm.county}
              onChange={(event) => setGroupForm({ ...groupForm, county: event.target.value })}
            />
          </label>
          <label className="form-field">
            {t("Main topic")}
            <input
              required
              minLength={2}
              maxLength={100}
              value={groupForm.topic}
              onChange={(event) => setGroupForm({ ...groupForm, topic: event.target.value })}
              placeholder="e.g. Market gardening"
            />
          </label>
        </div>
        <label className="form-field">
          {t("Description")}
          <textarea
            maxLength={1000}
            value={groupForm.description}
            onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })}
          />
        </label>
        <button className="btn g" disabled={busy}>
          {busy ? "Creating…" : t("Create farmer group")}
        </button>
      </form>

      <div className="grid">
        {groups.map((group) => (
          <article className="card" key={group.id}>
            <h3>{group.name}</h3>
            <p className="mut">{group.county} · {group.topic}</p>
            {group.description && <p>{group.description}</p>}
            <p className="mut">{group.member_count} member{group.member_count === 1 ? "" : "s"}</p>
            <button className="btn" onClick={() => void reportGroup(group)}>
              Report group
            </button>
            {group.is_member ? (
              <button className="btn g" onClick={() => setActiveGroupId(group.id)}>
                {t("Open group")}
              </button>
            ) : (
              <button className="btn" onClick={() => void joinGroup(group.id)}>
                {t("Join group")}
              </button>
            )}
          </article>
        ))}
      </div>
      {groups.length === 0 && <p className="mut">      {t("No groups yet. Create the first one.")}</p>}

      {activeGroup?.is_member && (
        <section className="group-discussion">
          <h3>{activeGroup.name}</h3>
          <form className="card product-form" onSubmit={(event) => void submitPost(event)}>
            <label className="form-field">
              {t("Post type")}
              <select
                value={postType}
                onChange={(event) =>
                  setPostType(event.target.value as "discussion" | "bulk_order")
                }
              >
                <option value="discussion">{t("Knowledge or discussion")}</option>
                <option value="bulk_order">{t("Bulk-order interest")}</option>
              </select>
            </label>
            {postType === "bulk_order" && (
              <div className="form-grid">
                <label className="form-field">
                  {t("Produce wanted")}
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={postForm.produce_name}
                    onChange={(event) =>
                      setPostForm({ ...postForm, produce_name: event.target.value })
                    }
                  />
                </label>
                <label className="form-field">
                  {t("Combined quantity of interest")}
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={postForm.quantity}
                    onChange={(event) =>
                      setPostForm({ ...postForm, quantity: event.target.value })
                    }
                  />
                </label>
              </div>
            )}
            <label className="form-field">
              {t("Message")}
              <textarea
                required
                minLength={2}
                maxLength={2000}
                value={postForm.body}
                onChange={(event) => setPostForm({ ...postForm, body: event.target.value })}
              />
            </label>
            <button className="btn g" disabled={busy}>
              {busy ? "Posting…" : t("Share with group")}
            </button>
          </form>
          {posts.map((post) => (
            <article className="card group-post" key={post.id}>
              <b>{post.author}</b>
              <span className="mut"> · {t(post.post_type === "bulk_order" ? "Bulk-order interest" : "Discussion")}</span>
              {!post.is_mine && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => void reportUser(post.author_id, post.author)}
                >
                  Report user
                </button>
              )}
              {post.post_type === "bulk_order" && (
                <p className="mut">
                  Looking for {post.quantity?.toLocaleString()} units of {post.produce_name}
                </p>
              )}
              <p>{post.body}</p>
              <small className="mut">{new Date(post.created_at).toLocaleString()}</small>
            </article>
          ))}
          {posts.length === 0 && <p className="mut">{t("No group posts yet.")}</p>}
        </section>
      )}
    </section>
  );
}
