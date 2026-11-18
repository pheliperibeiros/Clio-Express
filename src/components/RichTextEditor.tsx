import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  RemoveFormatting,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (htmlValue: string) => void;
  placeholder?: string;
  minHeightClass?: string;
  /** Nome acessível do campo; sem ele o editor é anunciado apenas como "editable". */
  label?: string;
}

function normalizeInitialHtml(val: string): string {
  if (!val) return '';
  const hasHtmlTags = /<\/?(p|div|br|b|strong|i|em|u|ul|ol|li|span|font)\b[^>]*>/i.test(val);
  if (hasHtmlTags) {
    return val;
  }
  // Convert plain text paragraphs/line breaks to clean HTML paragraphs
  const escaped = val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${line}</p>` : '<p><br></p>'))
    .join('');
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Digite o texto aqui...',
  minHeightClass = 'min-h-[110px]',
  label = 'Editor de texto',
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string>('');
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    justifyLeft: false,
    justifyCenter: false,
    justifyRight: false,
    justifyFull: false,
    insertUnorderedList: false,
    insertOrderedList: false,
  });

  // Sync external value updates without resetting user cursor on own typing
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastEmittedRef.current) {
      const normalized = normalizeInitialHtml(value);
      if (el.innerHTML !== normalized) {
        el.innerHTML = normalized;
      }
      lastEmittedRef.current = value;
    }
  }, [value]);

  const updateToolbarState = useCallback(() => {
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        justifyLeft: document.queryCommandState('justifyLeft'),
        justifyCenter: document.queryCommandState('justifyCenter'),
        justifyRight: document.queryCommandState('justifyRight'),
        justifyFull: document.queryCommandState('justifyFull'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    } catch {
      // ignore in environments where queryCommandState throws
    }
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (document.activeElement === editorRef.current) {
        updateToolbarState();
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [updateToolbarState]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmittedRef.current = html;
    onChange(html);
  };

  const execFormat = (command: string, commandValue?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, commandValue);
    emitChange();
    updateToolbarState();
  };

  // `mousedown` preserva a seleção do texto; `click` com `detail === 0` é a
  // ativação por teclado (Enter/Espaço). Sem o segundo caminho, a barra de
  // formatação só funcionava com o mouse.
  const toolbarHandler =
    (command: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.type === 'mousedown' || event.detail === 0) {
        event.preventDefault();
        execFormat(command);
      }
    };

  const btnClass = (isActive: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
      isActive
        ? 'bg-zinc-200 text-zinc-900'
        : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
    }`;

  const isEmpty = !value || value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-950 transition-colors focus-within:border-zinc-500">
      {/* Barra de formatação */}
      <div
        role="toolbar"
        aria-label="Formatação de texto"
        className="flex select-none flex-wrap items-center gap-0.5 border-b border-white/[0.06] bg-zinc-950 px-1.5 py-1"
      >
        <button
          type="button"
          onMouseDown={toolbarHandler('bold')}
          onClick={toolbarHandler('bold')}
          aria-label="Negrito"
          aria-pressed={activeFormats.bold}
          className={btnClass(activeFormats.bold)}
          title="Negrito (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={toolbarHandler('italic')}
          onClick={toolbarHandler('italic')}
          aria-label="Itálico"
          aria-pressed={activeFormats.italic}
          className={btnClass(activeFormats.italic)}
          title="Itálico (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={toolbarHandler('underline')}
          onClick={toolbarHandler('underline')}
          aria-label="Sublinhado"
          aria-pressed={activeFormats.underline}
          className={btnClass(activeFormats.underline)}
          title="Sublinhado (Ctrl+U)"
        >
          <Underline className="h-4 w-4" />
        </button>

        <span className="mx-1 h-4 w-px bg-white/[0.08]" />

        <button
          type="button"
          onMouseDown={toolbarHandler('justifyLeft')}
          onClick={toolbarHandler('justifyLeft')}
          aria-label="Alinhar à esquerda"
          aria-pressed={activeFormats.justifyLeft}
          className={btnClass(activeFormats.justifyLeft)}
          title="Alinhar à esquerda"
        >
          <AlignLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={toolbarHandler('justifyCenter')}
          onClick={toolbarHandler('justifyCenter')}
          aria-label="Centralizar"
          aria-pressed={activeFormats.justifyCenter}
          className={btnClass(activeFormats.justifyCenter)}
          title="Centralizar"
        >
          <AlignCenter className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={toolbarHandler('justifyRight')}
          onClick={toolbarHandler('justifyRight')}
          aria-label="Alinhar à direita"
          aria-pressed={activeFormats.justifyRight}
          className={btnClass(activeFormats.justifyRight)}
          title="Alinhar à direita"
        >
          <AlignRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={toolbarHandler('justifyFull')}
          onClick={toolbarHandler('justifyFull')}
          aria-label="Justificar"
          aria-pressed={activeFormats.justifyFull}
          className={btnClass(activeFormats.justifyFull)}
          title="Justificar"
        >
          <AlignJustify className="h-4 w-4" />
        </button>

        <span className="mx-1 h-4 w-px bg-white/[0.08]" />

        <button
          type="button"
          onMouseDown={toolbarHandler('insertUnorderedList')}
          onClick={toolbarHandler('insertUnorderedList')}
          aria-label="Lista com marcadores"
          aria-pressed={activeFormats.insertUnorderedList}
          className={btnClass(activeFormats.insertUnorderedList)}
          title="Lista com marcadores"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={toolbarHandler('insertOrderedList')}
          onClick={toolbarHandler('insertOrderedList')}
          aria-label="Lista numerada"
          aria-pressed={activeFormats.insertOrderedList}
          className={btnClass(activeFormats.insertOrderedList)}
          title="Lista numerada"
        >
          <ListOrdered className="h-4 w-4" />
        </button>

        <span className="mx-1 h-4 w-px bg-white/[0.08]" />

        <button
          type="button"
          onMouseDown={toolbarHandler('removeFormat')}
          onClick={toolbarHandler('removeFormat')}
          aria-label="Limpar formatação da seleção"
          className={btnClass(false)}
          title="Limpar formatação da seleção"
        >
          <RemoveFormatting className="h-4 w-4" />
        </button>
      </div>

      {/* Área editável: a folha do auto */}
      <div className="relative bg-[#f7f3ea] font-['Times_New_Roman',Times,serif]">
        {isEmpty && (
          <div className="pointer-events-none absolute left-3 top-2.5 text-sm text-zinc-500">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          onFocus={() => {
            try {
              document.execCommand('defaultParagraphSeparator', false, 'p');
            } catch {}
          }}
          onInput={emitChange}
          onKeyUp={updateToolbarState}
          onMouseUp={updateToolbarState}
          className={`w-full p-4 text-[13px] leading-relaxed text-zinc-900 outline-none ${minHeightClass} [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_p]:indent-12 [&_div]:indent-12 [&_[style*=center]]:!indent-0 [&_[style*=right]]:!indent-0 [&_li_p]:!indent-0 [&_li_div]:!indent-0`}
        />
      </div>
    </div>
  );
};
