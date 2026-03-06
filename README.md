# @mapleruf/tiptap-score

Tiptap extension + BubbleMenu UI for score editing with VexFlow.  
自分で使うようなのでヒソヒソとアップデートしていきます。

## Install

```bash
npm install git+ssh://git@github.com:mapleruf/tiptap-score.gi
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
## How to use
<img width="815" height="366" alt="image" src="https://github.com/user-attachments/assets/cb63ae55-b8f6-4921-a2d8-d40210937c21" />

初期状態の場合、五線上のクリックした任意の位置に音符を新規で追加します。  
また、既に配置された音符をクリックすることで、対象の音符おプロパティを変更することが出来ます。

### ノードの配置
`/score` を入力することで、キャンバスがエディタ上に追加されます。

### キーボード操作
- Shift + ↑ / ↓ ... 選択中の音符の音階を上下移動  
- Shift + ← / → ... 音符の選択を左右に移動  
- delete ... 選択中の音符を削除

### 譜面の変更
<img width="799" height="314" alt="image" src="https://github.com/user-attachments/assets/a0eaab22-f0cd-4737-bee6-79b408260430" />

キャンバスを右クリックすることで、譜面そのものに関しての見た目などを変更することができます。

- 拍子 ... 拍子の設定 / 変更
- 調号 ... 楽譜の調を設定 / 変更
- 譜表 ... 単不評と大譜表を切り替え
- 段数 ... 単譜表の場合にのみ設定可能。最大で４段まで五戦を増やせます。

### 音部記号の変更
<img width="805" height="228" alt="image" src="https://github.com/user-attachments/assets/abdf073f-8c78-46da-9a1b-c02b67e8c1e3" />

単譜表である場合、音部記号をクリックすることで音部記号を変更することが出来ます。
