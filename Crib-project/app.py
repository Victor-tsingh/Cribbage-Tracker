from flask import Flask, render_template, request, jsonify, session
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-prod")

# Names that trigger an instant loss (case-insensitive, whitespace-trimmed).
FORBIDDEN_NAMES = {"abiha", "abi"}


def new_game(target=121, names=None, dealer=0):
    """Initialize a fresh game state."""
    if names is None:
        names = ["Player 1", "Player 2"]
    return {
        "target": target,
        "names": names,
        "scores": [0, 0],
        "dealer": dealer,          # whose crib it is (0 or 1)
        "history": [],             # list of {player, points, before, after, time}
        "winner": None,
    }


def get_game():
    """Get the current game from session, or start a new one."""
    if "game" not in session:
        session["game"] = new_game()
    return session["game"]


def save_game(game):
    session["game"] = game
    session.modified = True


def check_winner(game):
    """Set winner and skunk status on game."""
    target = game["target"]
    for i, score in enumerate(game["scores"]):
        if score >= target:
            loser_score = game["scores"][1 - i]
            skunk_line = target * 3 // 4        # 90 for 121, ~45 for 61
            double_skunk_line = target // 2     # 60 for 121, 30 for 61
            if loser_score < double_skunk_line:
                status = "double_skunk"
            elif loser_score < skunk_line:
                status = "skunk"
            else:
                status = "win"
            game["winner"] = {
                "player": i,
                "name": game["names"][i],
                "status": status,
                "loser_score": loser_score,
            }
            return
    game["winner"] = None


def check_forbidden_names(game):
    """The Abiha rule: entering a forbidden name is an instant loss.

    If a player's name matches, the *other* player wins on the spot.
    Runs after name changes and after resets (so the rule re-fires if
    the name is still forbidden when a new game starts). Renaming away
    from a forbidden name lifts the curse — but only an abiha loss;
    a game won on points stays won.
    """
    any_forbidden = any(
        n.strip().lower() in FORBIDDEN_NAMES for n in game["names"])
    winner = game.get("winner")
    if winner and winner["status"] == "abiha" and not any_forbidden:
        game["winner"] = None
        return
    if winner:
        return
    for i, name in enumerate(game["names"]):
        if name.strip().lower() in FORBIDDEN_NAMES:
            other = 1 - i
            game["winner"] = {
                "player": other,
                "name": game["names"][other],
                "status": "abiha",
                "loser_score": game["scores"][i],
            }
            return


@app.route("/")
def index():
    game = get_game()
    return render_template("index.html", game=game)


@app.route("/api/state")
def api_state():
    return jsonify(get_game())


@app.route("/api/peg", methods=["POST"])
def api_peg():
    """Add points to a player's score."""
    data = request.get_json()
    player = int(data.get("player", 0))
    points = int(data.get("points", 0))

    if player not in (0, 1):
        return jsonify({"error": "invalid player"}), 400

    game = get_game()

    # No more pegging after someone wins
    if game.get("winner"):
        return jsonify(game)

    before = game["scores"][player]
    after = before + points
    if after < 0:
        after = 0
    if after > game["target"]:
        after = game["target"]

    game["scores"][player] = after
    game["history"].append({
        "player": player,
        "points": points,
        "before": before,
        "after": after,
        "time": datetime.now().strftime("%H:%M:%S"),
    })
    check_winner(game)
    save_game(game)
    return jsonify(game)


@app.route("/api/undo", methods=["POST"])
def api_undo():
    game = get_game()
    if game["history"]:
        last = game["history"].pop()
        game["scores"][last["player"]] = last["before"]
        check_winner(game)
        save_game(game)
    return jsonify(game)


@app.route("/api/reset", methods=["POST"])
def api_reset():
    data = request.get_json() or {}
    target = int(data.get("target", 121))
    if target not in (61, 121):
        target = 121
    game = get_game()
    # Loser of the last game traditionally deals first; otherwise alternate.
    if game.get("winner") and game["winner"]["status"] != "abiha":
        next_dealer = 1 - game["winner"]["player"]
    else:
        next_dealer = 1 - game.get("dealer", 0)
    new = new_game(target=target, names=game["names"], dealer=next_dealer)
    check_forbidden_names(new)
    save_game(new)
    return jsonify(new)


@app.route("/api/names", methods=["POST"])
def api_names():
    data = request.get_json() or {}
    game = get_game()
    if "player1" in data:
        game["names"][0] = (data["player1"] or "Player 1").strip()[:30]
    if "player2" in data:
        game["names"][1] = (data["player2"] or "Player 2").strip()[:30]
    check_forbidden_names(game)
    save_game(game)
    return jsonify(game)


@app.route("/api/dealer", methods=["POST"])
def api_dealer():
    data = request.get_json() or {}
    game = get_game()
    dealer = int(data.get("dealer", game.get("dealer", 0)))
    if dealer in (0, 1):
        game["dealer"] = dealer
    save_game(game)
    return jsonify(game)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
