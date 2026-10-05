# need-key
need key

<!DOCTYPE html>
<html>
<head>
    <title>我的联网国际象棋</title>
    <!-- 引入棋盘样式 -->
    <link rel="stylesheet" href="https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.css">
    <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; margin-top: 50px; }
        #myBoard { width: 400px; margin-bottom: 20px; }
        .status { font-weight: bold; color: #333; }
    </style>
</head>
<body>
    <h2>简易联网国际象棋</h2>
    <div id="myBoard"></div>
    <div class="status">状态: 等待开始...</div>

    <!-- 引入必要的脚本库 -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
    <script src="https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>

    <script>
        // 初始化游戏逻辑和棋盘
        var game = new Chess();
        var board = null;
        var socket = io();

        function onDragStart (source, piece, position, orientation) {
            if (game.game_over()) return false;
            // 只能移动白色的棋子（你可以改成允许移动黑色）
            if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
                (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }
        }

        function onDrop (source, target) {
            // 尝试走棋
            var move = game.move({
                from: source,
                to: target,
                promotion: 'q' // 简便起见，兵升变默认变后
            });

            // 如果是非法移动，棋子归位
            if (move === null) return 'snapback';

            updateStatus();
            // 将合法的移动发送给服务器
            socket.emit('move', move);
        }

        function onSnapEnd () {
            board.position(game.fen());
        }

        // 配置棋盘
        var config = {
            draggable: true,
            position: 'start',
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd
        };
        board = Chessboard('myBoard', config);

        // 接收来自服务器的对手走棋
        socket.on('move', function(msg) {
            game.move(msg);
            board.position(game.fen());
            updateStatus();
        });

        function updateStatus() {
            var status = '';
            var moveColor = '白方';
            if (game.turn() === 'b') moveColor = '黑方';

            if (game.in_checkmate()) {
                status = '游戏结束，' + moveColor + ' 被将死。';
            } else if (game.in_draw()) {
                status = '游戏结束，和棋。';
            } else {
                status = '轮到 ' + moveColor + ' 走棋';
                if (game.in_check()) status += '，' + moveColor + ' 被将军！';
            }
            $('.status').text(status);
        }
        
        updateStatus();
    </script>
</body>
</html>

