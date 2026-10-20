import { Renderer } from "@freelensapp/extensions";
import { getBlobEditorHeight } from "../utils";
import styles from "./pem-block.module.scss";

const {
  Component: { DrawerTitle, MonacoEditor },
} = Renderer;

/** A PEM text as a read-only code block, the large-blob idiom of DESIGN.md section 3. */
export function PemBlock({ title, value }: { title: string; value?: string }) {
  if (!value?.trim()) {
    return null;
  }

  return (
    <>
      <DrawerTitle>{title}</DrawerTitle>
      <MonacoEditor
        readOnly
        className={styles.editor}
        style={{ minHeight: getBlobEditorHeight(value) }}
        value={value}
        setInitialHeight
        options={{
          scrollbar: {
            alwaysConsumeMouseWheel: false,
          },
        }}
      />
    </>
  );
}
