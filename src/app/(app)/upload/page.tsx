import { requireUser } from "@/lib/auth";
import { UploadForm } from "./upload-form";

export default async function UploadPage() {
  await requireUser();
  return (
    <main>
      <h1>문서 업로드</h1>
      <UploadForm />
    </main>
  );
}
