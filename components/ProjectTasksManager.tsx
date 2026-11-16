"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isTaskOverdue, type ProjectTask, type ProjectTaskStatus, type TeamMember } from "@/lib/types";
import TextCell from "@/components/table/TextCell";
import DateCell from "@/components/table/DateCell";
import { pickableMembers } from "@/lib/team";

const STATUSES: ProjectTaskStatus[] = ["Not Started", "In Progress", "Done"];

export default function ProjectTasksManager({
  projectId,
  teamMembers,
  initialTasks,
}: {
  projectId: string;
  teamMembers: TeamMember[];
  initialTasks: ProjectTask[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tasks, setTasks] = useState<ProjectTask[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);

  const membersById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m.name])),
    [teamMembers]
  );

  async function updateTask(id: string, patch: Partial<ProjectTask>) {
    const previous = tasks;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const { error } = await supabase
      .from("project_tasks")
      .update(patch)
      .eq("id", id);
    if (error) {
      setTasks(previous);
      setError(error.message);
    }
  }

  async function addTask() {
    const { data, error } = await supabase
      .from("project_tasks")
      .insert({ project_id: projectId, task_name: "New task", status: "Not Started" })
      .select()
      .single();
    if (error || !data) {
      setError(error?.message ?? "Could not create task");
      return;
    }
    setTasks((prev) => [...prev, data as ProjectTask]);
  }

  async function deleteTask(id: string) {
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from("project_tasks").delete().eq("id", id);
    if (error) {
      setTasks(previous);
      setError(error.message);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Project Tasks</h2>
        <button
          type="button"
          onClick={addTask}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          + Add Task
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="px-2 py-2">Task</th>
              <th className="px-2 py-2">Owner</th>
              <th className="px-2 py-2">Due Date</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Notes</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-1 py-1 align-top">
                  <TextCell
                    value={task.task_name}
                    onCommit={(v) => updateTask(task.id, { task_name: v })}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <select
                    value={task.owner ?? ""}
                    onChange={(e) =>
                      updateTask(task.id, { owner: e.target.value || null })
                    }
                    className="w-full min-w-[8rem] rounded border border-transparent px-1.5 py-1 text-sm hover:border-neutral-300"
                  >
                    <option value="">Unassigned</option>
                    {pickableMembers(teamMembers, [task.owner]).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {task.owner && !membersById.has(task.owner) && (
                    <p className="px-1.5 text-xs text-neutral-400">(unknown)</p>
                  )}
                </td>
                <td className="px-1 py-1 align-top">
                  <DateCell
                    value={task.due_date}
                    overdue={isTaskOverdue(task)}
                    onCommit={(v) => updateTask(task.id, { due_date: v })}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <select
                    value={task.status}
                    onChange={(e) =>
                      updateTask(task.id, {
                        status: e.target.value as ProjectTaskStatus,
                      })
                    }
                    className="w-full min-w-[7rem] rounded border border-transparent px-1.5 py-1 text-sm hover:border-neutral-300"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1 align-top">
                  <TextCell
                    value={task.notes}
                    onCommit={(v) => updateTask(task.id, { notes: v })}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  {task.status !== "Done" && (
                    <button
                      type="button"
                      onClick={() => updateTask(task.id, { status: "Done" })}
                      className="mr-1 whitespace-nowrap rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      Mark Done
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteTask(task.id)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  No tasks yet. Click + Add Task to start a checklist.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
