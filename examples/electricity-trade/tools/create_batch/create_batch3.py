#!/usr/bin/python
#
# Copyright 2016 Intel Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ------------------------------------------------------------------------------

import argparse
import hashlib
import os
import logging
import random
import string
import time
import cbor

from sawtooth_signing import create_context
from sawtooth_signing import CryptoFactory

from sawtooth_sdk.protobuf import batch_pb2
from sawtooth_sdk.protobuf import transaction_pb2

from sawtooth_intkey.processor.handler import make_intkey_address


LOGGER = logging.getLogger(__name__)


class IntKeyPayload:
    def __init__(self, verb, name, value):
        self._verb = verb
        self._name = name
        self._value = value

        self._cbor = None
        self._sha512 = None

    def to_hash(self):
        return {
            'Verb': self._verb,
            'Name': self._name,
            'Value': self._value
        }

    def to_cbor(self):
        if self._cbor is None:
            self._cbor = cbor.dumps(self.to_hash(), sort_keys=True)
        return self._cbor

    def sha512(self):
        if self._sha512 is None:
            self._sha512 = hashlib.sha512(self.to_cbor()).hexdigest()
        return self._sha512


def create_intkey_transaction(verb, name, value, deps, signer):
    """Creates a signed intkey transaction.

    Args:
        verb (str): the action the transaction takes, either 'set', 'inc',
            or 'dec'
        name (str): the variable name which is altered by verb and value
        value (int): the amount to set, increment, or decrement
        deps ([str]): a list of transaction header_signatures which are
            required dependencies which must be processed prior to
            processing this transaction
        signer (:obj:`Signer`): the cryptographic signer for signing the
            transaction

    Returns:
        transaction (transaction_pb2.Transaction): the signed intkey
            transaction
    """
    payload = IntKeyPayload(
        verb=verb, name=name, value=value)

    # The prefix should eventually be looked up from the
    # validator's namespace registry.
    addr = make_intkey_address(name)

    header = transaction_pb2.TransactionHeader(
        signer_public_key=signer.get_public_key().as_hex(),
        family_name='intkey',
        family_version='1.0',
        inputs=[addr],
        outputs=[addr],
        dependencies=deps,
        payload_sha512=payload.sha512(),
        batcher_public_key=signer.get_public_key().as_hex(),
        nonce=hex(random.randint(0, 2**64)))

    header_bytes = header.SerializeToString()

    signature = signer.sign(header_bytes)

    transaction = transaction_pb2.Transaction(
        header=header_bytes,
        payload=payload.to_cbor(),
        header_signature=signature)

    return transaction


def create_batch(transactions, signer):
    transaction_signatures = [t.header_signature for t in transactions]

    header = batch_pb2.BatchHeader(
        signer_public_key=signer.get_public_key().as_hex(),
        transaction_ids=transaction_signatures)

    header_bytes = header.SerializeToString()

    signature = signer.sign(header_bytes)

    batch = batch_pb2.Batch(
        header=header_bytes,
        transactions=transactions,
        header_signature=signature)

    return batch


def generate_word():
    return ''.join([random.choice(string.ascii_letters) for _ in range(0, 6)])


def generate_word_list(count):
    if os.path.isfile('/usr/share/dict/words'):
        with open('/usr/share/dict/words', 'r') as fd:
            return {x.strip(): None for x in fd.readlines()[0:count]}
    else:
        return {generate_word(): None for _ in range(0, count)}


def do_populate(batches, keys, value):
    context = create_context('secp256k1')
    private_key = context.new_random_private_key()
    crypto_factory = CryptoFactory(context)
    signer = crypto_factory.new_signer(private_key)

    total_txn_count = 0
    txns = []
    for i in range(0, len(keys)):
        name = list(keys)[i]
        txn = create_intkey_transaction(
            verb='set',
            name=name,
            # value=random.randint(9000, 100000),
            value=value,
            deps=[],
            signer=signer)
        total_txn_count += 1
        txns.append(txn)
        # Establish the signature of the txn associated with the word
        # so we can create good dependencies later
        keys[name] = txn.header_signature

    batch = create_batch(
        transactions=txns,
        signer=signer)

    if value >= 0:
        batches.append(batch)


def do_generate(args, batches, keys, value, bNeedSetDesp):
    context = create_context('secp256k1')
    private_key = context.new_random_private_key()
    crypto_factory = CryptoFactory(context)
    signer = crypto_factory.new_signer(private_key)

    start = time.time()
    total_txn_count = 0
    for i in range(1):
        txns = []
        for _ in range(1):
            name = random.choice(list(keys))
            txn = create_intkey_transaction(
                # verb=random.choice(['inc', 'dec']),
                verb='inc',
                name=name,
                # value=random.randint(1, 10),
                value=value,
                # deps=[keys[name]],
                deps= [keys[name]] if bNeedSetDesp else [],
                signer=signer)
            total_txn_count += 1
            txns.append(txn)

        batch = create_batch(
            transactions=txns,
            signer=signer)

        batches.append(batch)

        if i % 100 == 0 and i != 0:
            stop = time.time()

            txn_count = 0
            for batch in batches[-100:]:
                txn_count += len(batch.transactions)

            fmt = 'batches {}, batch/sec: {:.2f}, txns: {}, txns/sec: {:.2f}'
            print(fmt.format(
                str(i),
                100 / (stop - start),
                str(total_txn_count),
                txn_count / (stop - start)))
            start = stop


def write_batch_file(args, batches):
    batch_list = batch_pb2.BatchList(batches=batches)
    print("Writing to {}...".format(args.output))
    with open(args.output, "wb") as fd:
        fd.write(batch_list.SerializeToString())


def do_create_batch(args):
    # print("##in do_create_batch")
    batches = []
    # print("##args.key_count", args.key_count)
    # print("##args.key_name", args.key_name)
    # keys = generate_word_list(args.key_count)
    keys = {args.key_name: None}
    # print("##keys", keys)
    # do_populate(batches, keys)
    # print("##args.value_set", args.value_set)
    do_populate(batches, keys, args.value_set)
    # print("##batches", batches)
    # do_generate(args, batches, keys)
    # print("##args.value_inc", args.value_inc)
    # print("##args.value_inc_rand", args.value_inc_rand)

    value_inc = args.value_inc
    if args.value_inc_rand >= 1:
        value_inc = random.randint(1, args.value_inc_rand)
        print("##inc value(random)", value_inc)

    if value_inc >= 0:
        # print("##call do_generate()")
        do_generate(args, batches, keys, value_inc, args.value_set >= 0)

    # print("##args", args)
    write_batch_file(args, batches)


def add_create_batch_parser(subparsers, parent_parser):

    epilog = '''
    details:
     create sample batch(es) of intkey transactions.
     populates state with intkey key/value pairs
     then generates batches with inc and dec transactions.
    '''

    parser = subparsers.add_parser(
        'create_batch',
        parents=[parent_parser],
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=epilog)

    parser.add_argument(
        '-o', '--output',
        type=str,
        help='location of output file',
        default='batches.intkey',
        metavar='')

    parser.add_argument(
        '-c', '--count',
        type=int,
        help='number of batches modifying random keys',
        default=1,
        metavar='')

    parser.add_argument(
        '-B', '--max-batch-size',
        type=int,
        help='max transactions per batch',
        default=10,
        metavar='')

    parser.add_argument(
        '-K', '--key-count',
        type=int,
        help='number of keys to set initially',
        default=1,
        metavar='')

    parser.add_argument(
        '-n', '--key-name',
        type=str,
        help='name of key',
        default='key1',
        metavar='')

    parser.add_argument(
        '-s', '--value-set',
        type=int,
        help='value of set',
        default=-1,
        metavar='')

    parser.add_argument(
        '-i', '--value-inc',
        type=int,
        help='value of inc',
        default=-1,
        metavar='')

    parser.add_argument(
        '-r', '--value-inc-rand',
        type=int,
        help='value of inc(random max)',
        default=0,
        metavar='')
