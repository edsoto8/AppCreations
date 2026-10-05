"""TermDeck: one app that tours the staples of a modern terminal UI."""

from __future__ import annotations

from datetime import datetime

from rich.text import Text
from textual import on
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, HorizontalGroup, Vertical, VerticalScroll
from textual.validation import Length, Number, Regex
from textual.widgets import (
    Button,
    Checkbox,
    DataTable,
    Digits,
    Footer,
    Header,
    Input,
    Label,
    ProgressBar,
    RadioButton,
    RadioSet,
    RichLog,
    Select,
    SelectionList,
    Sparkline,
    Static,
    Switch,
    TabbedContent,
    TabPane,
)
from textual.widgets.selection_list import Selection

from termdeck.data import TASKS, Service, make_services
from termdeck.screens import (
    STATUS_STYLE,
    ConfirmScreen,
    HelpScreen,
    QuickItem,
    QuickSelectScreen,
    ServiceDetailScreen,
)

# (column key, header label, attribute on Service)
COLUMNS = [
    ("name", "Service", "name"),
    ("region", "Region", "region"),
    ("status", "Status", "status"),
    ("cpu", "CPU %", "cpu"),
    ("memory", "Memory MB", "memory_mb"),
    ("uptime", "Uptime h", "uptime_h"),
    ("owner", "Owner", "owner"),
]
TAB_IDS = ["dashboard", "services", "tasks", "form", "log"]
THEMES = [
    "textual-dark",
    "nord",
    "gruvbox",
    "tokyo-night",
    "dracula",
    "catppuccin-mocha",
    "textual-light",
    "solarized-light",
]


class StatCard(Vertical):
    """A big-number tile for the dashboard."""

    def __init__(self, title: str, value: int, card_id: str) -> None:
        super().__init__(id=card_id, classes="stat-card")
        self.border_title = title
        self.value = value

    def compose(self) -> ComposeResult:
        yield Digits(str(self.value))


class TermDeckApp(App[None]):
    """A tour of modern TUI building blocks."""

    TITLE = "TermDeck"
    SUB_TITLE = "a modern TUI showcase"
    CSS_PATH = "app.tcss"

    BINDINGS = [
        Binding("question_mark,f1", "help", "Help", key_display="?"),
        Binding("ctrl+k,slash", "quick_select", "Quick select", key_display="^k"),
        Binding("t", "cycle_theme", "Theme"),
        Binding("q", "request_quit", "Quit"),
        Binding("escape", "blur", "Unfocus", show=False),
        *[
            Binding(str(n), f"show_tab('{tab}')", tab.title(), show=False)
            for n, tab in enumerate(TAB_IDS, start=1)
        ],
        # Services table
        Binding("s", "sort_next", "Sort", show=False),
        Binding("r", "sort_reverse", "Reverse", show=False),
        Binding("f", "focus_filter", "Filter", show=False),
        # Tasks
        Binding("a", "select_all", "All", show=False),
        Binding("n", "select_none", "None", show=False),
        Binding("c", "complete_tasks", "Complete", show=False),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.services: list[Service] = make_services()
        self.services_by_name = {s.name: s for s in self.services}
        self.tasks: list[tuple[str, str]] = list(TASKS)
        self.sort_column = "name"
        self.sort_reverse = False
        self.filter_text = ""
        self.deploy_progress = 0

    # ------------------------------------------------------------------ layout

    def compose(self) -> ComposeResult:
        yield Header()
        with TabbedContent(initial="dashboard"):
            with TabPane("1 Dashboard", id="dashboard"):
                yield from self.compose_dashboard()
            with TabPane("2 Services", id="services"):
                yield Input(placeholder="Filter services (name, region, owner, status)…", id="filter")
                yield DataTable(id="services-table", cursor_type="row", zebra_stripes=True)
                yield Static(id="table-status")
            with TabPane("3 Tasks", id="tasks"):
                yield from self.compose_tasks()
            with TabPane("4 Form", id="form"):
                yield from self.compose_form()
            with TabPane("5 Log", id="log"):
                yield RichLog(id="event-log", markup=True, wrap=True)
        yield Footer()

    def compose_dashboard(self) -> ComposeResult:
        counts = {status: 0 for status in STATUS_STYLE}
        for service in self.services:
            counts[service.status] += 1
        with VerticalScroll(id="dashboard-body"):
            with Horizontal(id="stat-row"):
                yield StatCard("Healthy", counts["healthy"], "card-healthy")
                yield StatCard("Degraded", counts["degraded"], "card-degraded")
                yield StatCard("Down", counts["down"], "card-down")
            with Vertical(classes="panel") as panel:
                panel.border_title = "CPU across the fleet"
                yield Sparkline([s.cpu for s in self.services], id="cpu-spark")
            with Horizontal(id="insight-row"):
                with Vertical(classes="panel") as panel:
                    panel.border_title = "Services by region"
                    yield Static(self.region_chart(), id="region-chart")
                with Vertical(classes="panel") as panel:
                    panel.border_title = "Hottest services"
                    yield Static(self.hottest(), id="hottest")
            with Vertical(classes="panel") as panel:
                panel.border_title = "Rolling deploy"
                yield ProgressBar(total=100, id="deploy-progress")
                yield Label("Deploying build #1042 to all regions…", id="deploy-label")

    def region_chart(self) -> str:
        counts: dict[str, int] = {}
        for service in self.services:
            counts[service.region] = counts.get(service.region, 0) + 1
        widest = max(counts.values())
        return "\n".join(
            f"{region:<13}[$accent]{'█' * round(20 * n / widest)}[/] {n}"
            for region, n in sorted(counts.items(), key=lambda kv: -kv[1])
        )

    def hottest(self) -> str:
        top = sorted(self.services, key=lambda s: -s.cpu)[:6]
        return "\n".join(f"{s.name:<18}[$warning]{s.cpu:>5.1f}%[/]  {s.region}" for s in top)

    def compose_tasks(self) -> ComposeResult:
        with Horizontal(id="tasks-body"):
            yield SelectionList[str](
                *(Selection(label, key, id=key) for label, key in self.tasks),
                id="task-list",
            )
            with Vertical(id="task-side"):
                yield Button("Select all  (a)", id="select-all")
                yield Button("Select none  (n)", id="select-none")
                yield Button("Complete  (c)", variant="success", id="complete")
                yield Static(id="task-summary")

    def compose_form(self) -> ComposeResult:
        with VerticalScroll(id="form-body"):
            with Horizontal(id="form-columns"):
                with Vertical(classes="form-column"):
                    yield Label("Service name")
                    yield Input(
                        placeholder="e.g. orders-api",
                        id="form-name",
                        validators=[Length(minimum=3, failure_description="Name needs 3+ characters")],
                    )
                    yield Label("Owner email")
                    yield Input(
                        placeholder="you@example.com",
                        id="form-email",
                        validators=[
                            Regex(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", failure_description="Not an email address")
                        ],
                    )
                    yield Label("Port")
                    yield Input(
                        placeholder="1-65535",
                        id="form-port",
                        type="integer",
                        validators=[Number(minimum=1, maximum=65535, failure_description="Port must be 1-65535")],
                    )
                with Vertical(classes="form-column"):
                    yield Label("Region")
                    yield Select(
                        [(r, r) for r in sorted({s.region for s in self.services})],
                        prompt="Pick a region",
                        id="form-region",
                    )
                    yield Label("Tier")
                    with RadioSet(id="form-tier"):
                        yield RadioButton("Free", value=True)
                        yield RadioButton("Pro")
                        yield RadioButton("Enterprise")
                    with HorizontalGroup(classes="switch-row"):
                        yield Switch(value=True, id="form-monitoring")
                        yield Label("Enable monitoring")
                    yield Checkbox("I accept the terms", id="form-terms")
            yield Static(id="form-errors")
            with HorizontalGroup(id="form-buttons"):
                yield Button("Create service", variant="primary", id="form-submit")
                yield Button("Reset", id="form-reset")

    # ------------------------------------------------------------- lifecycle

    def on_mount(self) -> None:
        self.populate_table()
        self.update_task_summary()
        self.set_interval(0.25, self.tick_deploy)
        self.log_event("TermDeck started. Press [b]?[/b] for help.")

    def tick_deploy(self) -> None:
        self.deploy_progress = (self.deploy_progress + 2) % 102
        self.query_one("#deploy-progress", ProgressBar).update(progress=self.deploy_progress)

    def log_event(self, message: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        self.query_one("#event-log", RichLog).write(f"[dim]{stamp}[/dim]  {message}")

    # -------------------------------------------------------- services table

    def visible_services(self) -> list[Service]:
        needle = self.filter_text.lower().strip()
        rows = [
            s
            for s in self.services
            if not needle or any(needle in v for v in (s.name, s.region, s.owner, s.status))
        ]
        attr = next(a for key, _, a in COLUMNS if key == self.sort_column)
        rows.sort(key=lambda s: getattr(s, attr), reverse=self.sort_reverse)
        return rows

    def populate_table(self) -> None:
        table = self.query_one("#services-table", DataTable)
        current = self.highlighted_service()
        table.clear(columns=True)
        arrow = " ▼" if self.sort_reverse else " ▲"
        for key, label, _ in COLUMNS:
            table.add_column(label + (arrow if key == self.sort_column else ""), key=key)
        rows = self.visible_services()
        for s in rows:
            colour = STATUS_STYLE[s.status]
            table.add_row(
                s.name,
                s.region,
                Text(f"● {s.status}", style=colour),
                Text(f"{s.cpu:.1f}", justify="right"),
                Text(f"{s.memory_mb:,}", justify="right"),
                Text(f"{s.uptime_h:,}", justify="right"),
                s.owner,
                key=s.name,
            )
        if current and current.name in {s.name for s in rows}:
            table.move_cursor(row=table.get_row_index(current.name))
        label = next(lbl for key, lbl, _ in COLUMNS if key == self.sort_column)
        self.query_one("#table-status", Static).update(
            f"{len(rows)} of {len(self.services)} services  ·  sorted by {label} "
            f"{'desc' if self.sort_reverse else 'asc'}  ·  s sort · r reverse · f filter · enter details"
        )

    def highlighted_service(self) -> Service | None:
        table = self.query_one("#services-table", DataTable)
        if table.row_count == 0:
            return None
        row_key, _ = table.coordinate_to_cell_key(table.cursor_coordinate)
        return self.services_by_name.get(row_key.value)

    def set_sort(self, column: str, reverse: bool) -> None:
        self.sort_column, self.sort_reverse = column, reverse
        self.populate_table()
        self.log_event(f"Sorted services by [b]{column}[/b] ({'desc' if reverse else 'asc'})")

    @on(DataTable.HeaderSelected, "#services-table")
    def header_clicked(self, event: DataTable.HeaderSelected) -> None:
        column = event.column_key.value
        reverse = not self.sort_reverse if column == self.sort_column else False
        self.set_sort(column, reverse)

    @on(Input.Changed, "#filter")
    def filter_changed(self, event: Input.Changed) -> None:
        self.filter_text = event.value
        self.populate_table()

    @on(Input.Submitted, "#filter")
    def filter_submitted(self) -> None:
        self.query_one("#services-table", DataTable).focus()

    @on(DataTable.RowSelected, "#services-table")
    def row_selected(self, event: DataTable.RowSelected) -> None:
        service = self.services_by_name[event.row_key.value]

        def after(result: str | None) -> None:
            if result == "restart":
                self.notify(f"Restarting {service.name}…", title="Restart queued")
                self.log_event(f"Restart queued for [b]{service.name}[/b]")

        self.push_screen(ServiceDetailScreen(service), after)

    def action_sort_next(self) -> None:
        keys = [key for key, _, _ in COLUMNS]
        self.set_sort(keys[(keys.index(self.sort_column) + 1) % len(keys)], False)

    def action_sort_reverse(self) -> None:
        self.set_sort(self.sort_column, not self.sort_reverse)

    def action_focus_filter(self) -> None:
        self.query_one("#filter", Input).focus()

    # ------------------------------------------------------------ tasks list

    def update_task_summary(self) -> None:
        task_list = self.query_one("#task-list", SelectionList)
        chosen = task_list.selected
        labels = [label for label, key in self.tasks if key in chosen]
        text = f"[b]{len(chosen)}[/b] of {len(self.tasks)} selected"
        if labels:
            text += "\n\n" + "\n".join(f"• {label}" for label in labels)
        self.query_one("#task-summary", Static).update(text)

    @on(SelectionList.SelectedChanged, "#task-list")
    def tasks_changed(self) -> None:
        self.update_task_summary()

    @on(Button.Pressed, "#select-all")
    def action_select_all(self) -> None:
        self.query_one("#task-list", SelectionList).select_all()

    @on(Button.Pressed, "#select-none")
    def action_select_none(self) -> None:
        self.query_one("#task-list", SelectionList).deselect_all()

    @on(Button.Pressed, "#complete")
    def action_complete_tasks(self) -> None:
        task_list = self.query_one("#task-list", SelectionList)
        chosen = list(task_list.selected)
        if not chosen:
            self.notify("Select one or more tasks first.", severity="warning")
            return

        def after(confirmed: bool | None) -> None:
            if not confirmed:
                return
            for key in chosen:
                task_list.remove_option(key)
            self.tasks = [(label, key) for label, key in self.tasks if key not in chosen]
            self.update_task_summary()
            self.notify(f"Completed {len(chosen)} task(s).", title="Nice work")
            self.log_event(f"Completed tasks: {', '.join(chosen)}")

        self.push_screen(ConfirmScreen(f"Mark {len(chosen)} task(s) as done?", "Complete"), after)

    # -------------------------------------------------------------------- form

    def form_inputs(self) -> list[Input]:
        return [self.query_one(f"#form-{name}", Input) for name in ("name", "email", "port")]

    @on(Button.Pressed, "#form-submit")
    def submit_form(self) -> None:
        errors: list[str] = []
        for field in self.form_inputs():
            result = field.validate(field.value)
            if result and not result.is_valid:
                errors.extend(result.failure_descriptions)
        region = self.query_one("#form-region", Select).value
        if region is Select.NULL:
            errors.append("Pick a region")
        if not self.query_one("#form-terms", Checkbox).value:
            errors.append("Accept the terms to continue")
        errors_box = self.query_one("#form-errors", Static)
        if errors:
            errors_box.update("\n".join(f"[red]✗[/red] {e}" for e in errors))
            self.notify(f"{len(errors)} problem(s) in the form.", severity="error")
            return
        errors_box.update("")
        name = self.query_one("#form-name", Input).value
        tier_button = self.query_one("#form-tier", RadioSet).pressed_button
        tier = str(tier_button.label) if tier_button else "Free"
        monitoring = self.query_one("#form-monitoring", Switch).value
        self.notify(f"{name} in {region} on the {tier} tier.", title="Service created")
        self.log_event(
            f"Created [b]{name}[/b] region={region} tier={tier} "
            f"monitoring={'on' if monitoring else 'off'}"
        )

    @on(Button.Pressed, "#form-reset")
    def reset_form(self) -> None:
        for field in self.form_inputs():
            field.clear()
        self.query_one("#form-region", Select).clear()
        self.query_one("#form-terms", Checkbox).value = False
        self.query_one("#form-errors", Static).update("")

    # ------------------------------------------------------------ app actions

    def check_action(self, action: str, parameters: tuple[object, ...]) -> bool | None:
        """Only enable tab-specific keys on their own tab."""
        tab = self.query_one(TabbedContent).active if self.is_mounted else ""
        if action in {"sort_next", "sort_reverse", "focus_filter"}:
            return tab == "services"
        if action in {"select_all", "select_none", "complete_tasks"}:
            return tab == "tasks"
        return True

    def action_show_tab(self, tab: str) -> None:
        self.query_one(TabbedContent).active = tab

    def focus_tab_content(self, tab: str) -> None:
        """Put focus on the main widget of a tab so its keys work straight away."""
        target = {
            "services": "#services-table",
            "tasks": "#task-list",
            "log": "#event-log",
        }.get(tab)
        if target:
            self.query_one(target).focus()

    @on(TabbedContent.TabActivated)
    def tab_changed(self, event: TabbedContent.TabActivated) -> None:
        self.focus_tab_content(event.pane.id or "")
        self.refresh_bindings()

    def action_blur(self) -> None:
        self.screen.set_focus(None)

    def action_help(self) -> None:
        self.push_screen(HelpScreen())

    def action_cycle_theme(self) -> None:
        themes = [t for t in THEMES if t in self.available_themes]
        current = themes.index(self.theme) if self.theme in themes else -1
        self.theme = themes[(current + 1) % len(themes)]
        self.notify(f"Theme: {self.theme}", timeout=1.5)

    def action_quick_select(self) -> None:
        items = [QuickItem("service", s.name, s.name) for s in self.services]
        items += [QuickItem("task", key, label) for label, key in self.tasks]
        self.push_screen(QuickSelectScreen(items), self.jump_to)

    def jump_to(self, item: QuickItem | None) -> None:
        if item is None:
            return
        if item.kind == "service":
            self.action_show_tab("services")
            filter_box = self.query_one("#filter", Input)
            filter_box.value = ""
            self.filter_text = ""
            self.populate_table()
            table = self.query_one("#services-table", DataTable)
            table.move_cursor(row=table.get_row_index(item.key))
            table.focus()
        else:
            self.action_show_tab("tasks")
            task_list = self.query_one("#task-list", SelectionList)
            task_list.select(item.key)
            task_list.highlighted = task_list.get_option_index(item.key)
            task_list.focus()
        self.log_event(f"Quick-selected {item.kind} [b]{item.label}[/b]")

    def action_request_quit(self) -> None:
        def after(confirmed: bool | None) -> None:
            if confirmed:
                self.exit()

        self.push_screen(ConfirmScreen("Quit TermDeck?", "Quit"), after)


def main() -> None:
    TermDeckApp().run()


if __name__ == "__main__":
    main()
