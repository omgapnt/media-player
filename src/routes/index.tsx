import { createFileRoute } from "@tanstack/react-router";
import { Kiln } from "@/components/kiln";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <Kiln />;
}
