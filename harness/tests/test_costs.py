from harness.agent.costs import CostLedger, format_eur, kosten_eur
from harness.providers.base import ProviderProfile

PRICED = ProviderProfile(name="p", api_mode="mock", preis_in_pro_mio=3.0, preis_out_pro_mio=2.0)
FREE = ProviderProfile(name="f", api_mode="mock")


def test_cost_arithmetic():
    # 1000 in × 3 €/Mio = 0.003 €; 500 out × 2 €/Mio = 0.001 € → 0.004 €
    assert kosten_eur(PRICED, 1000, 500) == 0.004


def test_no_price_means_none_and_dash():
    assert kosten_eur(FREE, 1000, 500) is None
    assert format_eur(None) == "—"
    assert format_eur(0.004) == "0,0040 €"
    assert format_eur(1234.5) == "1.234,5000 €"


def test_ledger_totals_and_estimate_flag():
    l = CostLedger()
    l.add(1, 1000, 500, provider="p", model="m")
    l.add(2, 0, 20, estimated=True)
    assert (l.input_tokens, l.output_tokens) == (1000, 520)
    assert l.estimated is True
    assert l.last_input_tokens == 1000  # an estimate without input does not overwrite the context size
    assert l.kosten_eur(PRICED) == 0.004 + 20 * 2.0 / 1_000_000
    assert [e.turn for e in l.entries] == [1, 2]
