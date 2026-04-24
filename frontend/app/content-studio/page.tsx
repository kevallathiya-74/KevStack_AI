"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextareaEditor } from "@/components/ui/TextareaEditor";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import {
  ApprovalDraft,
  approveDraft,
  fetchApprovalDrafts,
  generateApprovalDraft,
  getUserFriendlyError,
  publishApprovedDraft,
  rejectDraft,
} from "@/lib/api";

export default function ContentStudioPage() {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [topic, setTopic] = useState("");
  const [drafts, setDrafts] = useState<ApprovalDraft[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorHook, setEditorHook] = useState("");
  const [editorCta, setEditorCta] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState("Generate a draft, review it, then approve before publishing.");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [working, setWorking] = useState<"idle" | "generating" | "approving" | "publishing" | "rejecting">("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) || null,
    [drafts, selectedId]
  );
  const isBusy = working !== "idle";

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [pending, approved, pendingManual] = await Promise.all([
        fetchApprovalDrafts("pending_approval"),
        fetchApprovalDrafts("approved"),
        fetchApprovalDrafts("pending_manual"),
      ]);
      const merged = [...(approved.drafts || []), ...(pending.drafts || []), ...(pendingManual.drafts || [])];
      const unique = Array.from(new Map(merged.map((draft) => [draft.id, draft])).values());
      setDrafts(unique);
      if (!selectedId && unique.length > 0) {
        const latest = unique[0];
        setSelectedId(latest.id);
        setEditorContent(latest.content || "");
        setEditorHook(latest.hook || "");
        setEditorCta(latest.cta || "");
      }
    } catch (requestError) {
      const message = getUserFriendlyError(requestError, "Unable to load content studio context right now.");
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedId, toastError]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  async function handleGenerate() {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      const message = "Topic is required.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setWorking("generating");
    setStatusTone("neutral");
    try {
      const result = await generateApprovalDraft(normalizedTopic);
      const draft = result?.draft;
      if (!draft) {
        throw new Error("Draft generation failed.");
      }

      setDrafts((previous) => [draft, ...previous.filter((item) => item.id !== draft.id)]);
      setSelectedId(draft.id);
      setEditorContent(draft.content || "");
      setEditorHook(draft.hook || "");
      setEditorCta(draft.cta || "");
      setIsEditing(false);
      const message = "Draft generated and stored as pending approval.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess(message);
    } catch (error) {
      const message = getUserFriendlyError(error, "Unable to generate content right now.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setWorking("idle");
    }
  }

  function syncSelectionState(draft: ApprovalDraft) {
    setSelectedId(draft.id);
    setEditorContent(draft.content || "");
    setEditorHook(draft.hook || "");
    setEditorCta(draft.cta || "");
  }

  async function handleApproveOnly() {
    if (!selectedDraft) {
      return;
    }

    const payloadContent = isEditing ? editorContent.trim() : String(selectedDraft.content || "").trim();
    if (!payloadContent) {
      const message = "Draft content cannot be empty.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setWorking("approving");
    setStatusTone("neutral");
    try {
      const response = await approveDraft({
        postId: selectedDraft.id,
        approved: true,
        content: payloadContent,
        hook: editorHook.trim() || undefined,
        cta: editorCta.trim() || undefined,
      });

      const approvedDraft = response.draft;
      setDrafts((previous) => previous.map((item) => (item.id === approvedDraft.id ? approvedDraft : item)));
      syncSelectionState(approvedDraft);
      setIsEditing(false);
      const message = "Draft approved. You can now publish it.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess(message);
    } catch (error) {
      const message = getUserFriendlyError(error, "Unable to approve this draft right now.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setWorking("idle");
    }
  }

  async function handleApproveAndPublish() {
    if (!selectedDraft) {
      return;
    }

    const payloadContent = isEditing ? editorContent.trim() : String(selectedDraft.content || "").trim();
    if (!payloadContent) {
      const message = "Draft content cannot be empty.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setWorking("publishing");
    setStatusTone("neutral");
    setStatus("Approving and publishing with LinkedIn safety checks...");
    try {
      await approveDraft({
        postId: selectedDraft.id,
        approved: true,
        content: payloadContent,
        hook: editorHook.trim() || undefined,
        cta: editorCta.trim() || undefined,
      });

      const result = await publishApprovedDraft(selectedDraft.id);
      const message = result.reason || "Publish request completed.";
      setStatus(message);
      setStatusTone(result.published ? "success" : "neutral");
      if (result.draft) {
        setDrafts((previous) => previous.map((item) => (item.id === result.draft?.id ? result.draft : item)));
        syncSelectionState(result.draft);
      }
      setIsEditing(false);
      if (result.published) {
        toastSuccess(message);
      } else {
        if (
          message === "Session expired. Please reconnect LinkedIn." ||
          message === "Unable to connect LinkedIn. Please try again."
        ) {
          toastError(message);
          setStatusTone("error");
        } else {
          toastInfo(message);
        }
      }
    } catch (error) {
      const message = getUserFriendlyError(error, "Publish failed. Please try again.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setWorking("idle");
    }
  }

  async function handleReject() {
    if (!selectedDraft) {
      return;
    }

    setWorking("rejecting");
    setStatusTone("neutral");
    try {
      const response = await rejectDraft(selectedDraft.id);
      const rejected = response.draft;
      setDrafts((previous) => previous.map((item) => (item.id === rejected.id ? rejected : item)));
      syncSelectionState(rejected);
      setIsEditing(false);
      const message = "Draft rejected.";
      setStatus(message);
      setStatusTone("success");
      toastInfo(message);
    } catch (error) {
      const message = getUserFriendlyError(error, "Unable to reject this draft right now.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setWorking("idle");
    }
  }

  function handleSelectDraft(draft: ApprovalDraft) {
    syncSelectionState(draft);
    setIsEditing(false);
  }

  if (loading) {
    return (
      <div className="stack">
        <Card title="Content Approval Panel" subtitle="Generate, review, approve, then publish">
          <SkeletonCard lines={4} />
        </Card>
        <Card title="Draft Preview">
          <SkeletonCard lines={6} />
        </Card>
        <Card title="Approval Queue">
          <SkeletonCard lines={4} />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorState message={error} onRetry={() => void loadContext()} />
      </div>
    );
  }

  return (
    <div className="stack">
      <Card title="Content Approval Panel" subtitle="Generate content and publish only after explicit approval">
        <div className="inline-form">
          <input
            className="input"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Enter topic"
          />
          <Button onClick={handleGenerate} disabled={isBusy || !topic.trim()}>
            {working === "generating" ? "Generating..." : "Generate Draft"}
          </Button>
        </div>
        <p className={`status status--${statusTone}`}>{status}</p>
      </Card>

      <Card title="Draft Preview">
        {!selectedDraft ? (
          <EmptyState
            title="No draft selected"
            message="Generate a draft to start review and approval."
          />
        ) : (
          <>
            <div className="draft-meta">
              <span className={`badge badge--${String(selectedDraft.status || "pending_approval").toLowerCase()}`}>
                {selectedDraft.status}
              </span>
              <span className="muted">Draft ID: {selectedDraft.id}</span>
              <span className="muted">Topic: {selectedDraft.topic}</span>
            </div>

            {isEditing ? (
              <div className="stack">
                <input
                  className="input"
                  value={editorHook}
                  onChange={(event) => setEditorHook(event.target.value)}
                  placeholder="Hook"
                />
                <TextareaEditor value={editorContent} onChange={setEditorContent} placeholder="Edit post content" />
                <input
                  className="input"
                  value={editorCta}
                  onChange={(event) => setEditorCta(event.target.value)}
                  placeholder="CTA"
                />
              </div>
            ) : (
              <div className="draft-preview">
                <p className="draft-preview__hook">{selectedDraft.hook || "No hook"}</p>
                <p className="draft-preview__content">{selectedDraft.content}</p>
                <p className="draft-preview__cta">{selectedDraft.cta || "No CTA"}</p>
              </div>
            )}

            <div className="actions">
              <Button onClick={handleApproveOnly} disabled={isBusy || !selectedDraft}>
                {working === "approving" ? "Approving..." : "Approve"}
              </Button>
              <Button onClick={handleApproveAndPublish} disabled={isBusy || !selectedDraft}>
                {working === "publishing" ? "Publishing..." : "Approve & Post"}
              </Button>
              <Button onClick={() => setIsEditing((value) => !value)} disabled={isBusy || !selectedDraft} className="btn--ghost">
                {isEditing ? "Cancel Edit" : "Edit"}
              </Button>
              <Button onClick={handleReject} disabled={isBusy || !selectedDraft} className="btn--ghost">
                {working === "rejecting" ? "Rejecting..." : "Reject"}
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card title="Approval Queue">
        {!drafts.length ? (
          <EmptyState
            title="No drafts in queue"
            message="Generate content to create a pending approval draft."
          />
        ) : (
          <div className="approval-list">
            {drafts.map((draft) => {
              const active = selectedDraft?.id === draft.id;
              return (
                <button
                  key={draft.id}
                  type="button"
                  className={`approval-item ${active ? "is-active" : ""}`}
                  onClick={() => handleSelectDraft(draft)}
                >
                  <div className="approval-item__head">
                    <strong>#{draft.id}</strong>
                    <span className={`badge badge--${String(draft.status || "pending_approval").toLowerCase()}`}>{draft.status}</span>
                  </div>
                  <p className="approval-item__topic">{draft.topic || "No topic"}</p>
                  <p className="approval-item__excerpt">{String(draft.content || "").slice(0, 140)}...</p>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
