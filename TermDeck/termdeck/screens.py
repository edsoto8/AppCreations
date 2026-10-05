"""Modal screens: help overlay, confirm dialog, fuzzy quick-select, detail view."""

from __future__ import annotations

from dataclasses import dataclass

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Grid, Horizontal, Vertical, VerticalScroll
from textual.content import Content
from textual.fuzzy import Matcher
from textual.screen import ModalScreen
from textual.widgets import Button, Input, Label, Markdown, OptionList, Static
from textual.widgets.option_list import Option

from termdeck.data import Service

HELP_MARKDOWN = """\
# TermDeck keys

| Key | Action |
| --- | --- |
| `1`–`5` | Jump to a tab |
| `escape` | Leave a text box so single keys work again |
| `ctrl+k` or `/` | Quick select (fuzzy finder) |
| `ctrl+p` | Command palette |
| `t` | Cycle colour theme |
| `?` or `f1` | Toggle this help |
| `q` | Quit (asks first) |
| `tab` / `shift+tab` | Move focus |

## Services table
| Key | Action |
| --- | --- |
| `s` | Sort by next column |
| `r` | Reverse sort order |
| `f` | Focus the filter box |
| `enter` | Open service details |
| click header | Sort by that column |

## Tasks (multi-select)
| Key | Action |
| --- | --- |
| `space` / `enter` | Toggle the highlighted task |
| `a` | Select all |
| `n` | Select none |
| `c` | Complete selected (confirms first) |

Scroll with the arrow keys. Press `escape` or `?` to close.
"""


class HelpScreen(ModalScreen[None]):
    """A scrollable overlay listing every key binding."""

    BINDINGS = [
        Binding("escape", "close", "Close"),
        Binding("question_mark", "close", "Close", show=False),
    ]

    def compose(self) -> ComposeResult:
        with VerticalScroll(id="help-dialog", classes="dialog"):
            yield Markdown(HELP_MARKDOWN, id="help-body")

    def action_close(self) -> None:
        self.dismiss(None)


class ConfirmScreen(ModalScreen[bool]):
    """Yes / no dialog that returns a bool to the caller."""

    BINDINGS = [
        Binding("y", "answer(True)", "Yes"),
        Binding("n,escape", "answer(False)", "No"),
    ]

    def __init__(self, question: str, yes_label: str = "Yes") -> None:
        super().__init__()
        self.question = question
        self.yes_label = yes_label

    def compose(self) -> ComposeResult:
        with Grid(id="confirm-dialog", classes="dialog"):
            yield Label(self.question, id="confirm-question")
            yield Button(self.yes_label, variant="error", id="confirm-yes")
            yield Button("Cancel", variant="primary", id="confirm-no")

    def on_mount(self) -> None:
        self.query_one("#confirm-no", Button).focus()

    @on(Button.Pressed)
    def handle_button(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "confirm-yes")

    def action_answer(self, answer: bool) -> None:
        self.dismiss(answer)


@dataclass(frozen=True)
class QuickItem:
    """Something the fuzzy finder can jump to."""

    kind: str  # "service" or "task"
    key: str
    label: str


class QuickSelectScreen(ModalScreen[QuickItem | None]):
    """A fuzzy finder in the style of fzf / VS Code's ctrl+p."""

    BINDINGS = [
        Binding("escape", "cancel", "Cancel"),
        Binding("down", "cursor_down", "Down", show=False),
        Binding("up", "cursor_up", "Up", show=False),
    ]
    MAX_RESULTS = 50

    def __init__(self, items: list[QuickItem]) -> None:
        super().__init__()
        self.items = items
        self.matches: list[QuickItem] = []

    def compose(self) -> ComposeResult:
        with Vertical(id="quick-dialog", classes="dialog"):
            yield Input(placeholder="Type to fuzzy search services and tasks…", id="quick-input")
            yield OptionList(id="quick-results")
            yield Static(id="quick-count")

    def on_mount(self) -> None:
        self.refresh_results("")
        self.query_one("#quick-input", Input).focus()

    def ranked(self, query: str) -> list[tuple[float, QuickItem, Content]]:
        if not query:
            return [(1.0, item, Content(item.label)) for item in self.items]
        matcher = Matcher(query)
        scored = []
        for item in self.items:
            score = matcher.match(item.label)
            if score > 0:
                scored.append((score, item, matcher.highlight(item.label)))
        scored.sort(key=lambda entry: (-entry[0], entry[1].label))
        return scored

    def refresh_results(self, query: str) -> None:
        results = self.ranked(query)
        self.matches = [item for _, item, _ in results[: self.MAX_RESULTS]]
        option_list = self.query_one("#quick-results", OptionList)
        option_list.clear_options()
        option_list.add_options(
            Option(Content.assemble(label, ("  " + item.kind, "dim")), id=f"{item.kind}:{item.key}")
            for _, item, label in results[: self.MAX_RESULTS]
        )
        if self.matches:
            option_list.highlighted = 0
        self.query_one("#quick-count", Static).update(
            f"{len(results)} of {len(self.items)} match  ·  ↑↓ move  ·  enter pick  ·  esc close"
        )

    @on(Input.Changed, "#quick-input")
    def query_changed(self, event: Input.Changed) -> None:
        self.refresh_results(event.value)

    @on(Input.Submitted, "#quick-input")
    def pick_highlighted(self) -> None:
        index = self.query_one("#quick-results", OptionList).highlighted
        self.dismiss(self.matches[index] if index is not None and self.matches else None)

    @on(OptionList.OptionSelected, "#quick-results")
    def pick_clicked(self, event: OptionList.OptionSelected) -> None:
        self.dismiss(self.matches[event.option_index])

    def action_cursor_down(self) -> None:
        self.query_one("#quick-results", OptionList).action_cursor_down()

    def action_cursor_up(self) -> None:
        self.query_one("#quick-results", OptionList).action_cursor_up()

    def action_cancel(self) -> None:
        self.dismiss(None)


STATUS_STYLE = {"healthy": "green", "degraded": "yellow", "down": "red"}


class ServiceDetailScreen(ModalScreen[str | None]):
    """Details for one service, with actions that return to the caller."""

    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, service: Service) -> None:
        super().__init__()
        self.service = service

    def compose(self) -> ComposeResult:
        s = self.service
        colour = STATUS_STYLE[s.status]
        body = (
            f"[b]{s.name}[/b]\n\n"
            f"Status   [{colour}]● {s.status}[/{colour}]\n"
            f"Region   {s.region}\n"
            f"Owner    {s.owner}\n"
            f"CPU      {s.cpu:.1f}%\n"
            f"Memory   {s.memory_mb:,} MB\n"
            f"Uptime   {s.uptime_h:,} h"
        )
        with Vertical(id="detail-dialog", classes="dialog"):
            yield Static(body, id="detail-body")
            with Horizontal(id="detail-buttons"):
                yield Button("Restart", variant="warning", id="restart")
                yield Button("Close", variant="primary", id="close")

    @on(Button.Pressed)
    def handle_button(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id if event.button.id == "restart" else None)

    def action_close(self) -> None:
        self.dismiss(None)
