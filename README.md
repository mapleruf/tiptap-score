# @mapleruf/tiptap-score

Tiptap extension + BubbleMenu UI for score editing with VexFlow.

## Install

```bash
npm i @mapleruf/tiptap-score vexflow
```

For GitHub Packages, add `.npmrc` in your app/project root:

```ini
@mapleruf:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Usage

```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ScoreExtension, ScoreBubbleMenu } from '@mapleruf/tiptap-score'
import '@mapleruf/tiptap-score/style.css'

const editor = useEditor({
  extensions: [StarterKit, ScoreExtension],
  immediatelyRender: false,
})

return (
  <>
    {editor && <ScoreBubbleMenu editor={editor} />}
    <EditorContent editor={editor} />
  </>
)
```

## Publish

```bash
cd packages/tiptap-score
npm version patch
npm publish
```

Package is configured for GitHub Packages registry via `publishConfig.registry`.
