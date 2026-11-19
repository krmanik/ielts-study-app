"""python3 -m unittest discover -s writing -p 'test_*.py'"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content as C


class Content(unittest.TestCase):
    def test_hint(self):
        self.assertEqual(C.hint('a double-edged sword'), 'a d… s…')
        self.assertEqual(C.hint('if [X] then'), 'if […] t…')

    def test_inline_plain_and_cloze(self):
        s = C.inline('{It is argued that} [X] is **key** & <b>')
        self.assertIn('<span class="k" data-h="It is a… t…">It is argued that</span>', s)
        self.assertIn('<span class="s">[X]</span>', s)
        self.assertIn('<b>key</b>', s)
        self.assertIn('&amp; &lt;b&gt;', s)
        n = [0]
        z = C.inline('{one} and {two words}', 'cloze', n)
        self.assertEqual(z, '{{c1::one::o…}} and {{c2::two words::t… w…}}')
        self.assertEqual(n[0], 2)

    def test_body_lists(self):
        html, k = C.body_html(['para {a b}', '- one', '- {two}', '', 'end'])
        self.assertEqual(html.count('<ul>'), 1)
        self.assertEqual(html.count('<li>'), 2)
        self.assertTrue(html.endswith('<p>end</p>'))
        self.assertEqual(k, 2)

    def test_sources_parse(self):
        secs = C.band9()
        self.assertEqual(len(secs), 6)
        self.assertTrue(all(s['items'] for s in secs))
        self.assertEqual({s['skill'] for s in secs}, {'W', 'S'})
        ids = [f"{s['id']}/{i['id']}" for s in secs for i in s['items']]
        self.assertEqual(len(ids), len(set(ids)))
        ph = C.phrases()
        self.assertEqual(sum(len(s['items']) for s in ph), 192)

    def test_back_examples(self):
        h = C.back_html(['✗ wrong one', '✓ right one', 'plain'], lambda k: f'<{k}>')
        self.assertIn('<div class="l-ex no"><no><span>wrong one</span></div>', h)
        self.assertIn('<div class="l-ex ok"><ok><span>right one</span></div>', h)
        self.assertIn('<div>plain</div>', h)


if __name__ == '__main__':
    unittest.main()
