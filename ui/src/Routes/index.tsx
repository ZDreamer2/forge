import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceOverview } from "../Components/WorkspaceOverview/WorkspaceOverview";

export const Route = createFileRoute("/")({ component: WorkspaceOverview });
