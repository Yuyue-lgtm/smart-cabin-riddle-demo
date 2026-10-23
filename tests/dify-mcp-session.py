import ast
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


class MCPTransactionTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        with self.engine.begin() as connection:
            connection.execute(text('CREATE TABLE probe (id INTEGER PRIMARY KEY)'))
        tree = ast.parse(Path(sys.argv[1]).read_text())
        controller = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'MCPAppApi')
        method = next(node for node in controller.body if isinstance(node, ast.FunctionDef) and node.name == 'post')
        method.decorator_list = []
        namespace = {
            'sessionmaker': sessionmaker, 'db': SimpleNamespace(engine=self.engine),
            'request': SimpleNamespace(headers={}), 'mcp_ns': SimpleNamespace(payload={}),
            'MCPRequestPayload': SimpleNamespace(model_validate=lambda _: SimpleNamespace(id=1, model_dump=lambda **_: {})),
            'mcp_types': SimpleNamespace(InitializeRequest=type('InitializeRequest', (), {})),
            'negotiate_protocol_version': lambda *_: '2025-03-26',
        }
        exec(compile(ast.Module(body=[method], type_ignores=[]), '<actual-mcp-controller>', 'exec'), namespace)
        self.post = namespace['post']

    def tearDown(self):
        self.engine.dispose()

    def invoke(self, process):
        def load(_, session):
            session.execute(text('SELECT 1'))
            return object(), object()

        controller = SimpleNamespace(
            _parse_mcp_request=lambda _: SimpleNamespace(root=object()),
            _get_mcp_server_and_app=load, _validate_server_status=lambda _: None,
            _get_user_input_form=lambda _: [], _process_mcp_message=process,
        )
        return self.post(controller, 'fictional-server-code')

    def test_chat_generator_can_commit_then_keep_using_its_session(self):
        def generate(*args):
            session = args[-2]
            session.execute(text('INSERT INTO probe VALUES (1)'))
            session.commit()
            self.assertEqual(session.scalar(text('SELECT COUNT(*) FROM probe')), 1)
            return 'generated'

        self.assertEqual(self.invoke(generate), 'generated')

    def test_initialization_without_inner_commit_is_persisted(self):
        def initialize(*args):
            args[-2].execute(text('INSERT INTO probe VALUES (1)'))
            return 'initialized'

        self.assertEqual(self.invoke(initialize), 'initialized')
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(text('SELECT COUNT(*) FROM probe')), 1)

    def test_uncommitted_failure_rolls_back(self):
        def fail(*args):
            args[-2].execute(text('INSERT INTO probe VALUES (1)'))
            raise RuntimeError('fictional failure')

        with self.assertRaisesRegex(RuntimeError, 'fictional failure'):
            self.invoke(fail)
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(text('SELECT COUNT(*) FROM probe')), 0)


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]])
