package mailer

import "testing"

func TestAdresseReservee(t *testing.T) {
	for _, a := range []string{"marie@demo-samparis12.test", "x@club.invalid", "a@b.example", "a@exemple.localhost", "a@example.com", "a@mail.example.org", "A@DEMO-SAMPARIS12.TEST", " a@x.test ", "sans-arobase-mais.test", ""} {
		if !AdresseReservee(a) {
			t.Errorf("%q devrait être réservée", a)
		}
	}
	for _, a := range []string{"laurent@free.fr", "jean@samparis12.org", "a@contest.fr", "a@attest.com", "a@icloud.com", "a@exemple.fr", "a@monexample.com"} {
		if AdresseReservee(a) {
			t.Errorf("%q ne devrait pas être réservée", a)
		}
	}
}

func TestDelaiFr(t *testing.T) {
	for min, want := range map[int]string{15: "dans les 15 minutes", 30: "dans les 30 minutes", 60: "dans l'heure", 120: "dans les 2 heures", 240: "dans les 4 heures"} {
		if got := DelaiFr(min); got != want {
			t.Errorf("DelaiFr(%d) = %q, attendu %q", min, got, want)
		}
	}
}
