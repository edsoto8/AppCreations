"""Headless tests that drive TermDeck with Textual's Pilot."""

from __future__ import annotations

import pytest
from textual.widgets import Checkbox, DataTable, Input, OptionList, Select, SelectionList, Static, TabbedContent

from termdeck.app import TermDeckApp
from termdeck.screens import ConfirmScreen, HelpScreen, QuickSelectScreen, ServiceDetailScreen

SIZE = (110, 34)


def first_column(app: TermDeckApp) -> list[str]:
    table = app.query_one("#services-table", DataTable)
    return [str(table.get_row_at(i)[0]) for i in range(table.row_count)]


async def test_starts_on_dashboard_with_all_services():
    app = TermDeckApp()
    async with app.run_test(size=SIZE):
        assert app.query_one(TabbedContent).active == "dashboard"
        assert app.query_one("#services-table", DataTable).row_count == 120


async def test_number_keys_switch_tabs_and_focus_content():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("2")
        assert app.query_one(TabbedContent).active == "services"
        assert app.focused is app.query_one("#services-table")
        await pilot.press("3")
        assert app.query_one(TabbedContent).active == "tasks"
        assert app.focused is app.query_one("#task-list")


async def test_table_sorts_by_key_and_reverses():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("2")
        names = first_column(app)
        assert names == sorted(names)
        await pilot.press("r")
        assert first_column(app) == sorted(names, reverse=True)
        await pilot.press("s", "s", "s")  # name -> region -> status -> cpu
        assert app.sort_column == "cpu" and not app.sort_reverse
        cpus = [s.cpu for s in app.visible_services()]
        assert cpus == sorted(cpus)


async def test_header_click_sorts_column():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("2")
        table = app.query_one("#services-table", DataTable)
        table.post_message(DataTable.HeaderSelected(table, table.columns.get("uptime").key, 5, label=None))
        await pilot.pause()
        assert app.sort_column == "uptime"
        table.post_message(DataTable.HeaderSelected(table, table.columns.get("uptime").key, 5, label=None))
        await pilot.pause()
        assert app.sort_reverse


async def test_filter_narrows_table():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("2", "f", *"down")
        table = app.query_one("#services-table", DataTable)
        expected = [s for s in app.services if s.status == "down"]
        assert table.row_count == len(expected) > 0
        assert "of 120 services" in str(app.query_one("#table-status", Static).render())


async def test_enter_opens_detail_modal():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("2", "enter")
        assert isinstance(app.screen, ServiceDetailScreen)
        await pilot.press("escape")
        assert not isinstance(app.screen, ServiceDetailScreen)


async def test_multi_select_and_complete_with_confirm():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("3", "space", "down", "space")
        task_list = app.query_one("#task-list", SelectionList)
        assert task_list.selected == ["certs", "postgres"]
        await pilot.press("c")
        assert isinstance(app.screen, ConfirmScreen)
        await pilot.press("y")
        await pilot.pause()
        assert task_list.option_count == 8
        assert task_list.selected == []


async def test_select_all_and_none():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("3", "a")
        task_list = app.query_one("#task-list", SelectionList)
        assert len(task_list.selected) == 10
        await pilot.press("n")
        assert task_list.selected == []


async def test_cancel_complete_keeps_tasks():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("3", "a", "c", "n")
        await pilot.pause()
        assert app.query_one("#task-list", SelectionList).option_count == 10


async def test_quick_select_fuzzy_jumps_to_service():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("ctrl+k")
        assert isinstance(app.screen, QuickSelectScreen)
        await pilot.press(*"chkapi2")
        results = app.screen.query_one("#quick-results", OptionList)
        assert results.option_count >= 1
        assert results.get_option_at_index(0).id == "service:checkout-api-2"
        await pilot.press("enter")
        await pilot.pause()
        assert app.query_one(TabbedContent).active == "services"
        assert app.highlighted_service().name == "checkout-api-2"


async def test_quick_select_task_selects_it():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("slash", *"postmortem", "enter")
        await pilot.pause()
        assert app.query_one(TabbedContent).active == "tasks"
        assert "postmortem" in app.query_one("#task-list", SelectionList).selected


async def test_quick_select_escape_cancels():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("ctrl+k", "escape")
        assert app.query_one(TabbedContent).active == "dashboard"


async def test_help_overlay_toggles():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("question_mark")
        assert isinstance(app.screen, HelpScreen)
        await pilot.press("question_mark")
        assert not isinstance(app.screen, HelpScreen)


async def test_theme_cycles():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        before = app.theme
        await pilot.press("t")
        assert app.theme != before


async def test_form_reports_validation_errors():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("4")
        app.query_one("#form-name", Input).value = "ab"
        app.query_one("#form-email", Input).value = "nope"
        app.query_one("#form-port", Input).value = "70000"
        app.query_one("#form-submit").press()
        await pilot.pause()
        errors = str(app.query_one("#form-errors", Static).render())
        for text in ("3+ characters", "email", "1-65535", "region", "terms"):
            assert text in errors


async def test_form_submits_when_valid():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("4")
        app.query_one("#form-name", Input).value = "orders-api"
        app.query_one("#form-email", Input).value = "dev@example.com"
        app.query_one("#form-port", Input).value = "8080"
        app.query_one("#form-region", Select).value = "eu-west"
        app.query_one("#form-terms", Checkbox).value = True
        app.query_one("#form-submit").press()
        await pilot.pause()
        assert str(app.query_one("#form-errors", Static).render()) == ""
        assert any("Service created" in (n.title or "") for n in app._notifications)


async def test_escape_leaves_text_box_so_keys_work():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("2", "f", "x")
        assert app.query_one("#filter", Input).value == "x"
        await pilot.press("escape", "3")
        assert app.query_one(TabbedContent).active == "tasks"


async def test_quit_asks_first():
    app = TermDeckApp()
    async with app.run_test(size=SIZE) as pilot:
        await pilot.press("q")
        assert isinstance(app.screen, ConfirmScreen)
        await pilot.press("n")
        assert app.is_running
        await pilot.press("q", "y")
        await pilot.pause()
    assert app.return_code == 0


@pytest.mark.parametrize("width,height", [(80, 24), (160, 48)])
async def test_renders_at_common_sizes(width, height):
    app = TermDeckApp()
    async with app.run_test(size=(width, height)) as pilot:
        for key in "12345":
            await pilot.press(key)
        assert app.export_screenshot()
