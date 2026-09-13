import importlib
import pkgutil

import pytest

import radar


def get_all_radar_modules():
    modules = []
    prefix = radar.__name__ + "."
    for _, modname, _ in pkgutil.walk_packages(radar.__path__, prefix):
        modules.append(modname)
    return sorted(modules)


@pytest.mark.parametrize("modname", get_all_radar_modules())
def test_import_radar_module(modname: str):
    """
    Ensures that every module inside radar can be imported without throwing NameError,
    ImportError, or SyntaxError due to missing typing imports or broken dependencies.
    """
    module = importlib.import_module(modname)
    assert module is not None
