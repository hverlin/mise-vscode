import { toDisplayPath, useOpenFileMutation } from "../webviewVsCodeApi";

export function FileLink({ filePath }: { filePath: string }) {
	const openFileMutation = useOpenFileMutation();

	return (
		<a
			href={`file://${filePath}`}
			onClick={(e) => {
				e.preventDefault();
				openFileMutation.mutate(filePath);
			}}
		>
			{toDisplayPath(filePath || "")}
		</a>
	);
}
